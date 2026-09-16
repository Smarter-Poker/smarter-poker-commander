/**
 * Table Assignment API
 * GET  /api/commander/table-assignments - List all tables with current assignments
 * PUT  /api/commander/table-assignments - Assign a table to a mode (inactive/cash/tournament)
 * POST /api/commander/table-assignments - Close a table (end all sessions, set inactive)
 *
 * Auth: guardManager - uses x-staff-session header for Commander staff PIN sessions.
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardManager } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardManager(req, res); if (!_g) return;

    try {
      // 2026-08-20 audit fix: the venue used to be re-read from the RAW
      // x-staff-session header. guardManager above already verified and
      // resolved the session, so take the venue from its result and never
      // parse the client-supplied header again.
      let venueId = _g.venue_id;

      // Fallback: Bearer token
      if (!venueId) {
        try {
          const authHeader = req.headers.authorization;
          if (authHeader) {
            const token = authHeader.replace('Bearer ', '');
            const { data: authData } = await getSupabase().auth.getUser(token);
            const user = authData?.user;
            if (user) {
              // MULTI-CLUB FIX: limit(1) — unscoped maybeSingle errors for
              // users with staff rows at 2+ venues
              const { data: staff } = await getSupabase()
                .from('commander_staff')
                .select('venue_id')
                .or(`user_id.eq.${user.id},linked_user_id.eq.${user.id}`)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();
              venueId = staff?.venue_id;
            }
          }
        } catch (e) { console.warn('[App] Handled exception:', e); }
      }

      if (!venueId) return res.status(403).json({ success: false, error: 'Could not determine venue' });

      // Staff identity comes from the verified session, not the raw header.
      const staffUserId = _g.user_id || _g.linked_user_id || _g.id || null;

      if (req.method === 'GET') return handleGet(req, res, venueId);
      if (req.method === 'PUT') return handlePut(req, res, venueId, staffUserId);
      if (req.method === 'POST') return handleClose(req, res, venueId, staffUserId);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Table assignment error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// GET: List all tables with their current assignments + active game info
async function handleGet(req, res, venueId) {
  // Get all tables for this venue
  const { data: tables, error } = await getSupabase()
    .from('commander_tables')
    .select('*')
    .eq('venue_id', venueId)
    .order('table_number')
        .limit(100)

  if (error) return res.status(500).json({ success: false, error: 'Failed to fetch tables' });

  // Get active games at this venue (to determine which tables are running cash games)
  const { data: games } = await getSupabase()
    .from('commander_games')
    .select('id, table_id, game_type, stakes, current_players, max_players, status, started_at')
    .eq('venue_id', venueId)
    .in('status', ['waiting', 'running', 'active'])

  // Get active tournaments at this venue
  const { data: tournaments } = await getSupabase()
    .from('commander_tournaments')
    .select('id, name, status, game_type, buyin_amount, max_entries')
    .eq('venue_id', venueId)
    // 2026-08-20: 'registering' is not a value the status CHECK allows (the
    // real value is 'registration'), so a tournament that had opened
    // registration never appeared in the table-assignments dropdown and could
    // not be given tables. 'registering'/'late_registration' kept as harmless
    // legacy aliases.
    .in('status', ['scheduled', 'registration', 'registering', 'running', 'paused', 'final_table', 'hand_for_hand', 'late_registration'])
    .order('created_at', { ascending: false });

  // Get session counts per table (fallback player count)
  const { data: sessions } = await getSupabase()
    .from('commander_table_sessions')
    .select('table_number')
    .eq('venue_id', venueId)
    .eq('status', 'active')
        .limit(100);

  const sessionCounts = {};
  (sessions || []).forEach(s => {
    sessionCounts[s.table_number] = (sessionCounts[s.table_number] || 0) + 1;
  });

  // Map games to tables by table_id
  const gamesByTableId = {};
  (games || []).forEach(g => {
    if (!gamesByTableId[g.table_id]) gamesByTableId[g.table_id] = [];
    gamesByTableId[g.table_id].push(g);
  });

  // Enrich tables with mode, game info, and player counts
  const enriched = (tables || []).map(t => {
    const activeGames = gamesByTableId[t.id] || [];
    const activeGame = activeGames.find(g => ['running', 'active', 'waiting'].includes(g.status));

    // Use persisted mode as primary source of truth, fall back to derivation
    let mode = t.mode || 'inactive';
    let gameType = t.game_type || null;
    let stakes = t.stakes || null;
    let activePlayers = sessionCounts[t.table_number] || 0;
    let currentGameId = null;
    let tournamentId = t.tournament_id || null;

    if (activeGame) {
      if (mode === 'inactive') mode = 'cash'; // auto-upgrade if game exists
      gameType = activeGame.game_type || gameType;
      stakes = activeGame.stakes || stakes;
      activePlayers = activeGame.current_players || activePlayers;
      currentGameId = activeGame.id;
    }

    if (tournamentId && mode !== 'tournament') {
      mode = 'tournament';
    }

    return {
      id: t.id,
      table_number: t.table_number,
      table_name: t.table_name || `Table ${t.table_number}`,
      max_seats: t.max_seats || 9,
      status: t.status || 'available',
      mode,
      game_type: gameType,
      stakes,
      tournament_id: tournamentId,
      current_game_id: currentGameId,
      active_players: activePlayers,
      open_seats: (t.max_seats || 9) - activePlayers,
      is_active: t.is_active !== false,
      label: t.label || null,
    };
  });

  return res.status(200).json({
    success: true,
    data: {
      tables: enriched,
      tournaments: tournaments || []
    }
  });
}

// PUT: Assign a table to a mode
async function handlePut(req, res, venueId, staffUserId) {
  const { table_id, mode, game_type, stakes, tournament_id } = req.body;

  if (!table_id || !mode) {
    return res.status(400).json({ success: false, error: 'table_id and mode required' });
  }
  if (!['inactive', 'cash', 'tournament'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'mode must be inactive, cash, or tournament' });
  }
  if (mode === 'cash' && game_type && !stakes) {
    // stakes is optional - only validate if game_type is provided
  }

  // Verify table belongs to venue
  const { data: table } = await getSupabase()
    .from('commander_tables')
    .select('*')
    .eq('id', table_id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

  // 2026-08-20: refuse to reassign a table out from under live tournament
  // players. Switching a tournament table to cash/inactive nulls tournament_id
  // while commander_tournament_entries still point at that table number, so the
  // players vanish from the floor map, the TD console and auto-break while
  // still sitting at the table. The new tournament tables endpoint already
  // guards this; this is the legacy path that did not.
  const leavingTournament = table.tournament_id &&
    (mode !== 'tournament' || String(tournament_id || '') !== String(table.tournament_id));
  if (leavingTournament) {
    const { data: seatedPlayers, error: seatedErr } = await getSupabase()
      .from('commander_tournament_entries')
      .select('player_name, seat_number')
      .eq('tournament_id', table.tournament_id)
      .eq('table_number', table.table_number)
      // SEAT OCCUPANCY: this guard exists to stop a table being taken out
      // from under people who are sitting at it. 'bagged' excluded on purpose
      // - they hold no chair, and bag-and-tag deliberately frees these tables
      // for the room overnight.
      .in('status', ['seated', 'active'])
      .limit(20);

    if (seatedErr) {
      console.error('[table-assignments] seated-player check failed', {
        table_id, code: seatedErr.code, message: seatedErr.message
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Could Not Verify Whether Players Are Seated At This Table' }
      });
    }
    if (seatedPlayers && seatedPlayers.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'TABLE_OCCUPIED',
          message: `Table ${table.table_number} Still Has ${seatedPlayers.length} Tournament Player(s). Break This Table From The Tournament Director Console First.`
        },
        data: { players: seatedPlayers.map(p => ({ player_name: p.player_name, seat_number: p.seat_number })) }
      });
    }
  }

  // Build update - persist BOTH mode and table_purpose as source of truth
  // mode values: 'cash', 'tournament', 'inactive'
  // table_purpose values: 'cash_game', 'tournament', null
  const tablePurpose = mode === 'cash' ? 'cash_game' : mode === 'tournament' ? 'tournament' : null;
  const updates = {
    mode,
    table_purpose: tablePurpose,
    game_type: mode === 'cash' ? game_type : null,
    stakes: mode === 'cash' ? stakes : null,
    tournament_id: mode === 'tournament' ? tournament_id : null,
    status: mode === 'inactive' ? 'available' : 'in_use'
  };

  // If assigning to cash, also create a commander_games entry
  if (mode === 'cash') {
    // Close any existing games on this table first
    await getSupabase()
      .from('commander_games')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('table_id', table_id)
      .eq('venue_id', venueId)
      .in('status', ['waiting', 'running', 'active']);

    // Create new game
    await getSupabase().from('commander_games').insert({
      venue_id: venueId,
      table_id: table_id,
      game_type: game_type ? String(game_type).toLowerCase() : game_type, // 2026-07-25 audit fix: commander_games.game_type is stored lowercase
      stakes: stakes,
      max_players: table.max_seats || 9,
      status: 'waiting',
      started_at: new Date().toISOString()
    });
  }

  // If setting to inactive, close any active games
  if (mode === 'inactive') {
    await getSupabase()
      .from('commander_games')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('table_id', table_id)
      .eq('venue_id', venueId)
      .in('status', ['waiting', 'running', 'active']);
  }

  const { data: updated, error } = await getSupabase()
    .from('commander_tables')
    .update(updates)
    .eq('id', table_id)
    .select()
    .maybeSingle();

  if (error) {
    console.warn('Assignment update error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update table assignment' });
  }

  return res.status(200).json({ success: true, data: updated });
}

// POST: Close a table (end sessions, set inactive)
async function handleClose(req, res, venueId, staffUserId) {
  const { table_id } = req.body;
  if (!table_id) return res.status(400).json({ success: false, error: 'table_id required' });

  const { data: table } = await getSupabase()
    .from('commander_tables')
    .select('*')
    .eq('id', table_id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

  // 2026-08-20: same guard as the reassignment path. Closing a tournament
  // table nulls tournament_id and deletes its seat rows while live
  // commander_tournament_entries still reference that table number, orphaning
  // the players. Breaking the table from the TD console is the correct route
  // because it MOVES the players first and prints their seat change cards.
  if (table.tournament_id) {
    const { data: seatedPlayers, error: seatedErr } = await getSupabase()
      .from('commander_tournament_entries')
      .select('player_name, seat_number')
      .eq('tournament_id', table.tournament_id)
      .eq('table_number', table.table_number)
      // SEAT OCCUPANCY, same rule as the assignment guard above: only a
      // player physically at this table blocks the close.
      .in('status', ['seated', 'active'])
      .limit(20);

    if (seatedErr) {
      console.error('[table-assignments] close seated-player check failed', {
        table_id, code: seatedErr.code, message: seatedErr.message
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Could Not Verify Whether Players Are Seated At This Table' }
      });
    }
    if (seatedPlayers && seatedPlayers.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'TABLE_OCCUPIED',
          message: `Table ${table.table_number} Still Has ${seatedPlayers.length} Tournament Player(s). Break This Table From The Tournament Director Console So Their Seat Change Cards Print.`
        },
        data: { players: seatedPlayers.map(p => ({ player_name: p.player_name, seat_number: p.seat_number })) }
      });
    }
  }

  // Close all active games on this table
  await getSupabase()
    .from('commander_games')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('table_id', table_id)
    .eq('venue_id', venueId)
    .in('status', ['waiting', 'running', 'active']);

  // End all active sessions at this table
  await getSupabase()
    .from('commander_table_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('venue_id', venueId)
    .eq('table_number', table.table_number)
    .eq('status', 'active');

  // Clear seats
  await getSupabase()
    .from('commander_table_seats')
    .delete()
    .eq('venue_id', venueId)
    .eq('table_number', table.table_number);

  // Set table to inactive - sync BOTH mode and table_purpose
  const { data: updated } = await getSupabase()
    .from('commander_tables')
    .update({
      mode: 'inactive',
      table_purpose: null,
      game_type: null,
      stakes: null,
      tournament_id: null,
      status: 'available',
      current_game_id: null,
    })
    .eq('id', table_id)
    .select()
    .maybeSingle();

  return res.status(200).json({ success: true, data: updated });
}
