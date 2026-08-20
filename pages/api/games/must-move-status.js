/**
 * Must-Move Games Management API - Chain-Based
 * GET /api/commander/games/must-move-status?venue_id=X
 *   Returns active games grouped by type+stakes with chain-ordered must-move relationships.
 *   Chain example: T7 → T4 → T1 (players move one step at a time, not all to main).
 * POST /api/commander/games/must-move-status
 *   Move next player from source table to target table (next in chain).
 *   Body: { must_move_game_id, target_game_id }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method === 'GET') return handleGet(req, res);
    if (req.method === 'POST') return handlePost(req, res);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleGet(req, res) {
  try {
    const { venue_id } = req.query;
    if (!venue_id) return res.status(400).json({ success: false, error: 'venue_id required' });

    // Get all active games
    const { data: games, error } = await getSupabase()
      .from('commander_games')
      .select('id, game_type, stakes, status, table_id, is_must_move, parent_game_id, current_players, max_players, created_at, dealer_staff_id')
      .eq('venue_id', venue_id)
      .in('status', ['waiting', 'running'])
      .order('created_at', { ascending: true })

    if (error) throw error;

    // Get table info separately
    const tableIds = [...new Set((games || []).filter(g => g.table_id).map(g => g.table_id))];
    let tablesMap = {};
    if (tableIds.length > 0) {
      const { data: tables } = await getSupabase()
        .from('commander_tables')
        .select('id, table_number, table_name, max_seats')
        .in('id', tableIds);
      (tables || []).forEach(t => { tablesMap[t.id] = t; });
    }

    // Get all seats for these games (for the must-move queue)
    const gameIds = (games || []).map(g => g.id);
    let seatsMap = {}; // game_id -> [seats ordered by seated_at]
    if (gameIds.length > 0) {
      const { data: seats } = await getSupabase()
        .from('commander_seats')
        .select('id, game_id, seat_number, player_id, player_name, status, seated_at, buyin_amount, created_at')
        .in('game_id', gameIds)
        .eq('status', 'occupied')
        .order('seated_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true }); // 2026-07-25 audit fix: semicolon prevents ASI treating next line's ( as a call

      (seats || []).forEach(s => {
        if (!seatsMap[s.game_id]) seatsMap[s.game_id] = [];
        seatsMap[s.game_id].push(s);
      });
    }

    // Get waitlist counts per game type+stakes
    let waitlistCounts = {};
    try {
      const { data: wlEntries } = await getSupabase()
        .from('commander_waitlist')
        .select('game_type, stakes')
        .eq('venue_id', venue_id)
        .in('status', ['waiting', 'called']); // 2026-07-25 audit fix: semicolon prevents ASI treating next line's ( as a call
      (wlEntries || []).forEach(w => {
        const key = `${w.game_type}|${w.stakes}`;
        waitlistCounts[key] = (waitlistCounts[key] || 0) + 1;
      });
    } catch { /* non-critical */ }

    // Enrich games
    const enriched = (games || []).map(g => ({
      ...g,
      table_number: tablesMap[g.table_id]?.table_number || null,
      table_name: tablesMap[g.table_id]?.table_name || null,
      max_seats: tablesMap[g.table_id]?.max_seats || g.max_players || 9,
      player_count: (seatsMap[g.id] || []).length,
      seats: seatsMap[g.id] || [],
    }));

    // Group by game_type + stakes
    const groups = {};
    enriched.forEach(g => {
      const key = `${g.game_type}|${g.stakes}`;
      if (!groups[key]) groups[key] = { game_type: g.game_type, stakes: g.stakes, all: [] };
      groups[key].all.push(g);
    });

    // Only return groups with 2+ tables (must-move candidates)
    const candidates = Object.values(groups || {}).filter(g => g.all.length >= 2);

    // ── Defensive: fix orphaned must-move flags ──
    const activeGameIds = new Set(enriched.map(g => g.id));
    const orphans = enriched.filter(g =>
      g.is_must_move && (!g.parent_game_id || !activeGameIds.has(g.parent_game_id))
    );
    if (orphans.length > 0) {
      const orphanIds = orphans.map(g => g.id);
      await getSupabase()
        .from('commander_games')
        .update({ is_must_move: false, parent_game_id: null })
        .in('id', orphanIds);
      orphans.forEach(g => { g.is_must_move = false; g.parent_game_id = null; });
    }

    // ── Build chain-ordered groups ──
    // Chain order: oldest game = main, next oldest = 2nd (feeds into main),
    // next = 3rd (feeds into 2nd), etc.
    for (const group of candidates) {
      // Sort by created_at ascending (oldest first = main)
      group.all.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      // The main game is the oldest non-must-move, or just the oldest
      group.main = group.all.find(g => !g.is_must_move) || group.all[0];

      // Build the chain: chain[0] = main, chain[1] = 2nd, chain[2] = 3rd, etc.
      const chain = [group.main];
      const remaining = group.all.filter(g => g.id !== group.main.id);

      // Sort remaining by created_at (oldest = closest to main, newest = furthest)
      remaining.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      chain.push(...remaining);

      // Auto-link: each game in the chain should point to the previous game
      const updatePromises = [];
      for (let i = 1; i < chain.length; i++) {
        const game = chain[i];
        const targetGame = chain[i - 1]; // move to the table one step closer to main

        if (!game.is_must_move || game.parent_game_id !== targetGame.id) {
          updatePromises.push(
            getSupabase()
              .from('commander_games')
              .update({ is_must_move: true, parent_game_id: targetGame.id })
              .eq('id', game.id)
          );
          // Update local data
          game.is_must_move = true;
          game.parent_game_id = targetGame.id;
        }

        // Annotate with chain metadata for the frontend
        game.chain_position = i; // 1 = 2nd table, 2 = 3rd table, etc.
        game.move_target_game_id = targetGame.id;
        game.move_target_table_number = targetGame.table_number;
      }

      // Main game metadata
      group.main.chain_position = 0;
      group.main.move_target_game_id = null;
      group.main.move_target_table_number = null;

      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
      }

      group.chain = chain;
    }

    // Also return all singles for reference
    const singles = Object.values(groups || {}).filter(g => g.all.length === 1);

    // Attach waitlist counts
    candidates.forEach(g => {
      const key = `${g.game_type}|${g.stakes}`;
      g.waitlist_count = waitlistCounts[key] || 0;
    });

    return res.status(200).json({
      success: true,
      data: {
        must_move_groups: candidates,
        single_games: singles.map(g => g.all[0]),
        total_active: enriched.length,
      }
    });
  } catch (err) {
    console.warn('Must-move status error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handlePost(req, res) {
  try {
    // Accept both old format (main_game_id) and new format (target_game_id)
    const { must_move_game_id, target_game_id, main_game_id } = req.body;
    const actualTargetId = target_game_id || main_game_id;

    if (!must_move_game_id || !actualTargetId) {
      return res.status(400).json({ success: false, error: 'must_move_game_id and target_game_id required' });
    }

    // Get the must-move game's oldest occupied seat (first in line to move)
    const { data: seats } = await getSupabase()
      .from('commander_seats')
      .select('id, game_id, seat_number, player_id, player_name, seated_at, created_at')
      .eq('game_id', must_move_game_id)
      .eq('status', 'occupied')
      .order('seated_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(1);

    if (!seats || seats.length === 0) {
      return res.status(400).json({ success: false, error: 'No players at must-move table' });
    }

    const playerToMove = seats[0];

    // Get target game info (this could be another must-move game or the main game)
    const { data: targetGame } = await getSupabase()
      .from('commander_games')
      .select('id, table_id, current_players, max_players')
      .eq('id', actualTargetId)
      .maybeSingle();

    if (!targetGame) return res.status(404).json({ success: false, error: 'Target game not found' });

    const { data: targetTable } = await getSupabase()
      .from('commander_tables')
      .select('id, table_number, max_seats')
      .eq('id', targetGame.table_id)
      .maybeSingle();

    if (!targetTable) return res.status(404).json({ success: false, error: 'Target table not found' });

    // Find an open seat at the target game
    const { data: targetSeats } = await getSupabase()
      .from('commander_seats')
      .select('seat_number')
      .eq('game_id', actualTargetId)
      .eq('status', 'occupied');

    const occupiedSeats = new Set((targetSeats || []).map(s => s.seat_number));
    const maxSeats = targetTable.max_seats || targetGame.max_players || 9;
    let openSeat = null;
    for (let i = 1; i <= maxSeats; i++) {
      if (!occupiedSeats.has(i)) { openSeat = i; break; }
    }

    if (openSeat === null) {
      return res.status(400).json({ success: false, error: 'No open seats at target table' });
    }

    // Get source game info for the response
    const { data: mmGame } = await getSupabase()
      .from('commander_games')
      .select('table_id, current_players')
      .eq('id', must_move_game_id)
      .maybeSingle();

    const { data: mmTable } = await getSupabase()
      .from('commander_tables')
      .select('table_number')
      .eq('id', mmGame?.table_id)
      .maybeSingle();

    // Move the player (INSERT FIRST, THEN DELETE - if insert fails, player stays at source):
    // 1. Insert a new seat at the target game FIRST
    const { error: insertError } = await getSupabase().from('commander_seats').insert({
      game_id: actualTargetId,
      seat_number: openSeat,
      player_id: playerToMove.player_id,
      player_name: playerToMove.player_name,
      status: 'occupied',
      seated_at: new Date().toISOString(),
    });

    if (insertError) {
      console.warn('Must-move insert error:', insertError);
      return res.status(500).json({ success: false, error: 'Failed to seat player at target table' });
    }

    // 2. Delete their seat at the must-move table (safe - player already seated at target)
    await getSupabase().from('commander_seats').delete().eq('id', playerToMove.id);

    // 3. Update player counts using actual seat counts (not stale fields)
    const { count: sourceCount } = await getSupabase()
      .from('commander_seats')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', must_move_game_id)
      .eq('status', 'occupied');

    const { count: targetCount } = await getSupabase()
      .from('commander_seats')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', actualTargetId)
      .eq('status', 'occupied');

    await getSupabase()
      .from('commander_games')
      .update({ current_players: sourceCount ?? 0 })
      .eq('id', must_move_game_id);

    await getSupabase()
      .from('commander_games')
      .update({ current_players: targetCount ?? 0 })
      .eq('id', actualTargetId);

    const fromTable = mmTable?.table_number || '?';
    const toTable = targetTable.table_number;

    return res.status(200).json({
      success: true,
      data: {
        player_name: playerToMove.player_name,
        from_table: fromTable,
        to_table: toTable,
        to_seat: openSeat,
        message: `${playerToMove.player_name} moved from Table ${fromTable} → Table ${toTable} Seat ${openSeat}`
      }
    });
  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Must-move transfer error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
