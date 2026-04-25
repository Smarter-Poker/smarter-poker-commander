/**
 * Tournament Auto-Break Detection & Execution
 * GET  /api/commander/tournaments/[id]/auto-break - Check if break conditions met, suggest which table
 * POST /api/commander/tournaments/[id]/auto-break - Execute the break with assignments, return receipt data
 *
 * Auto-break logic:
 * - Count total open seats across all OTHER tournament tables
 * - If open seats >= number of players at the smallest table → suggest breaking that table
 * - The system picks the table with fewest players to break
 * - Generates optimal seat assignments distributing players across tables with open seats
 * - Returns printable receipt data for wireless printer
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    const { id: tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Tournament ID required' });

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });

      if (req.method === 'GET') return handleCheck(req, res, tournament);
      if (req.method === 'POST') return handleExecute(req, res, tournament);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Auto-break error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getTableData(tournamentId, venueId) {
  // Get tournament tables
  const { data: tables } = await getSupabase()
    .from('commander_tables')
    .select('id, table_number, max_seats')
    .eq('venue_id', venueId)
    .eq('tournament_id', tournamentId)
    .eq('mode', 'tournament')
        .limit(100)

  if (!tables || tables.length < 2) return { tables: tables || [], entries: [], tableMap: {} };

  // Get active entries with their seats
  const { data: entries } = await getSupabase()
    .from('commander_tournament_entries')
    .select('id, player_name, table_number, seat_number, current_chips, member_id')
    .eq('tournament_id', tournamentId)
    .in('status', ['active', 'seated'])
    .order('table_number')
    .order('seat_number');

  // Build table occupancy map
  const tableMap = {};
  for (const t of tables) {
    tableMap[t.table_number] = {
      ...t,
      players: [],
      open_seats: []
    };
  }
  for (const e of (entries || [])) {
    if (tableMap[e.table_number]) {
      tableMap[e.table_number].players.push(e);
    }
  }
  // Calculate open seats
  for (const tNum of Object.keys(tableMap || {})) {
    const t = tableMap[tNum];
    const occupied = new Set(t.players.map(p => p.seat_number));
    for (let s = 1; s <= t.max_seats; s++) {
      if (!occupied.has(s)) t.open_seats.push(s);
    }
  }

  return { tables, entries: entries || [], tableMap };
}

// GET: Check break conditions
async function handleCheck(req, res, tournament) {
  const { tables, entries, tableMap } = await getTableData(tournament.id, tournament.venue_id);

  if (tables.length < 2) {
    return res.status(200).json({
      success: true,
      data: {
        should_break: false,
        reason: tables.length === 0 ? 'No tournament tables' : 'Only one table remaining — final table',
        tables_active: tables.length,
        total_players: entries.length
      }
    });
  }

  // Find table with fewest players (candidate to break)
  const tableStats = Object.values(tableMap || {})
    .filter(t => t.players.length > 0)
    .sort((a, b) => a.players.length - b.players.length);

  if (tableStats.length < 2) {
    return res.status(200).json({
      success: true,
      data: { should_break: false, reason: 'Not enough active tables', tables_active: tableStats.length }
    });
  }

  // If the TD explicitly requests to break a specific table (manual break),
  // use THAT table as the break candidate — not the auto-detected smallest table.
  const forceTableNum = req.query.force_table ? parseInt(req.query.force_table) : null;
  const breakCandidate = forceTableNum
    ? tableStats.find(t => t.table_number === forceTableNum) || tableStats[0]
    : tableStats[0]; // default: smallest table (auto-break)

  const otherTables = tableStats.filter(t => t.table_number !== breakCandidate.table_number);

  // Count total open seats on OTHER tables
  const totalOpenSeats = otherTables.reduce((sum, t) => sum + t.open_seats.length, 0);
  const playersToMove = breakCandidate.players.length;
  const shouldBreak = totalOpenSeats >= playersToMove;

  // Generate suggested assignments if break is possible
  let assignments = [];
  if (shouldBreak) {
    assignments = generateAssignments(breakCandidate.players, otherTables);
  }

  return res.status(200).json({
    success: true,
    data: {
      should_break: shouldBreak,
      break_table: breakCandidate.table_number,
      players_to_move: playersToMove,
      open_seats_available: totalOpenSeats,
      reason: shouldBreak
        ? `Table ${breakCandidate.table_number} has ${playersToMove} players, ${totalOpenSeats} open seats available on other tables`
        : `Need ${playersToMove} open seats but only ${totalOpenSeats} available`,
      assignments,
      tables_active: tableStats.length,
      total_players: entries.length,
      table_summary: tableStats.map(t => ({
        table_number: t.table_number,
        players: t.players.length,
        max_seats: t.max_seats,
        open_seats: t.open_seats.length
      }))
    }
  });
}

// Generate optimal seat assignments — distribute players evenly
function generateAssignments(playersToMove, destinationTables) {
  const assignments = [];
  // Sort destinations by most open seats first (fill bigger gaps first)
  const dests = destinationTables
    .map(t => ({ ...t, available: [...t.open_seats] }))
    .sort((a, b) => b.available.length - a.available.length);

  // Round-robin distribute players across tables to keep them balanced
  let destIdx = 0;
  for (const player of playersToMove) {
    // Find next table with available seats
    let attempts = 0;
    while (dests[destIdx].available.length === 0 && attempts < dests.length) {
      destIdx = (destIdx + 1) % dests.length;
      attempts++;
    }
    if (dests[destIdx].available.length === 0) break; // shouldn't happen if shouldBreak was true

    const seat = dests[destIdx].available.shift();
    assignments.push({
      entry_id: player.id,
      player_name: player.player_name,
      member_id: player.member_id,
      from_table: player.table_number,
      from_seat: player.seat_number,
      to_table: dests[destIdx].table_number,
      to_seat: seat,
      chips: player.current_chips
    });
    destIdx = (destIdx + 1) % dests.length;
  }

  return assignments;
}

// POST: Execute the break
async function handleExecute(req, res, tournament) {
  const { break_table, assignments } = req.body;

  if (!break_table || !Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ success: false, error: 'break_table and assignments array required' });
  }

  const errors = [];
  const moved = [];

  // Fetch real venue data from both tables in parallel
  const [venueRes, settingsRes] = await Promise.all([
    getSupabase().from('venues').select('name, city, state').eq('id', tournament.venue_id).maybeSingle(),
    getSupabase().from('commander_venue_settings').select('club_logo_url').eq('venue_id', tournament.venue_id).maybeSingle()
  ]);
  const venueName = venueRes.data?.name || 'Smarter Poker';
  const venueCity = venueRes.data?.city || null;
  const venueState = venueRes.data?.state || null;
  const venueLogoUrl = settingsRes.data?.club_logo_url || null;

  // Validate no seat conflicts
  const seatKeys = new Set();
  for (const a of assignments) {
    const key = `${a.to_table}-${a.to_seat}`;
    if (seatKeys.has(key)) {
      return res.status(400).json({ success: false, error: `Duplicate seat: Table ${a.to_table} Seat ${a.to_seat}` });
    }
    seatKeys.add(key);
  }

  // Execute moves
  for (const a of assignments) {
    const { data: currentEntry } = await getSupabase()
      .from('commander_tournament_entries')
      .select('metadata')
      .eq('id', a.entry_id)
      .maybeSingle();

    const existingMetadata = currentEntry?.metadata || {};

    const { error } = await getSupabase()
      .from('commander_tournament_entries')
      .update({
        table_number: a.to_table,
        seat_number: a.to_seat,
        metadata: {
          ...existingMetadata,
          last_moved_at: new Date().toISOString(),
          last_moved_from: { table: a.from_table, seat: a.from_seat },
          move_reason: 'table_break'
        }
      })
      .eq('id', a.entry_id);

    if (error) {
      errors.push({ entry_id: a.entry_id, error: error.message });
    } else {
      moved.push(a);
    }
  }

  // Release the broken table back to inactive (ONLY if all players successfully moved)
  if (errors.length === 0) {
    await getSupabase()
      .from('commander_tables')
      .update({
        mode: 'inactive',
        tournament_id: null,
        status: 'available',
        assigned_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('venue_id', tournament.venue_id)
      .eq('table_number', break_table);
  } else {
  }

  // Build receipt data for printing (full venue-level identity)
  const receipts = moved.map(a => ({
    tournament_name: tournament.name,
    venue_name: venueName,
    venue_city: venueCity,
    venue_state: venueState,
    venue_logo_url: venueLogoUrl,
    buyin_amount: tournament.buyin_amount,
    player_name: a.player_name,
    from_table: a.from_table,
    from_seat: a.from_seat,
    to_table: a.to_table,
    to_seat: a.to_seat,
    chips: a.chips,
    timestamp: new Date().toISOString()
  }));

  return res.status(200).json({
    success: errors.length === 0,
    data: {
      table_broken: break_table,
      players_moved: moved.length,
      moves: moved,
      receipts,
      errors: errors.length > 0 ? errors : undefined
    }
  });
}
