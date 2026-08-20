/**
 * Random Seat Draw API
 * POST /api/commander/tournaments/[id]/seat-draw
 *
 * TableCaptain-style seat draw: every unseated 'registered' entry gets a random
 * table and seat. Already-seated players keep their seats; the draw fills the
 * remaining open seats only, balancing players across tables.
 *
 * Table sources, in order:
 *  1. commander_tables rows assigned to this tournament (tournament_id match)
 *  2. body.tables: [{ table_number, max_seats }]
 *  3. Synthesized tables numbered 1..N with body.seats_per_table (default 9)
 *
 * Response includes the full assignment list for printing seat cards.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../src/lib/commander/audit';
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

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
      });
    }
    if (!applyRateLimit(req, res, LIMITS.write)) return;
    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { id: tournamentId } = req.query;

    const { data: tournament } = await getSupabase()
      .from('commander_tournaments')
      .select('id, venue_id, name, status, starting_chips')
      .eq('id', tournamentId)
      .maybeSingle();

    if (!tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }
    if (!['scheduled', 'registration', 'registering', 'running', 'paused'].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Seat Draw Is Not Available For This Tournament Status' }
      });
    }

    // Entries: seated players hold their seats; registered players get drawn.
    const { data: allEntries } = await getSupabase()
      .from('commander_tournament_entries')
      .select('id, player_name, status, table_number, seat_number, current_chips')
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'seated', 'active'])
      .limit(5000);

    const entries = allEntries || [];
    const seated = entries.filter(e => e.table_number && e.seat_number);
    const toSeat = shuffle(entries.filter(e => !e.table_number || !e.seat_number));

    if (toSeat.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'NOTHING_TO_DRAW', message: 'Every Entry Already Has A Seat' }
      });
    }

    // Resolve tables.
    let tables = [];
    const { data: dbTables } = await getSupabase()
      .from('commander_tables')
      .select('table_number, max_seats')
      .eq('venue_id', tournament.venue_id)
      .eq('tournament_id', tournamentId)
      .neq('status', 'closed')
      .order('table_number', { ascending: true })
      .limit(200);

    if (dbTables && dbTables.length > 0) {
      tables = dbTables.map(t => ({ table_number: t.table_number, max_seats: t.max_seats || 9 }));
    } else if (Array.isArray(req.body?.tables) && req.body.tables.length > 0) {
      tables = req.body.tables
        .filter(t => Number.isInteger(t.table_number) && t.table_number > 0)
        .map(t => ({ table_number: t.table_number, max_seats: Math.min(10, Math.max(2, t.max_seats || 9)) }));
    } else {
      const perTable = Math.min(10, Math.max(2, Number(req.body?.seats_per_table) || 9));
      const totalPlayers = seated.length + toSeat.length;
      const needed = Math.max(1, Math.ceil(totalPlayers / perTable));
      // Skip table numbers already in use by seated players to avoid collisions.
      const usedNumbers = new Set(seated.map(e => e.table_number));
      let n = 1;
      while (tables.length < needed) {
        tables.push({ table_number: n, max_seats: perTable });
        usedNumbers.add(n);
        n++;
      }
    }

    if (tables.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_TABLES', message: 'No Tables Available For The Draw' }
      });
    }

    // Build the open-seat pool, excluding seats already occupied.
    const occupied = new Set(seated.map(e => `${e.table_number}:${e.seat_number}`));
    const openSeats = [];
    for (const t of tables) {
      for (let s = 1; s <= t.max_seats; s++) {
        const key = `${t.table_number}:${s}`;
        if (!occupied.has(key)) openSeats.push({ table_number: t.table_number, seat_number: s });
      }
    }

    if (openSeats.length < toSeat.length) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NOT_ENOUGH_SEATS',
          message: `Only ${openSeats.length} Open Seats For ${toSeat.length} Players. Add Tables And Retry.`
        }
      });
    }

    // Balanced fill: round-robin across tables so no table starts short-handed
    // while another is full. Seats within a table are still random.
    const seatsByTable = new Map();
    for (const seat of openSeats) {
      if (!seatsByTable.has(seat.table_number)) seatsByTable.set(seat.table_number, []);
      seatsByTable.get(seat.table_number).push(seat);
    }
    for (const [k, v] of seatsByTable) seatsByTable.set(k, shuffle(v));
    // Order tables by current occupancy (fewest players first) for the round robin.
    const occupancy = new Map();
    for (const t of tables) occupancy.set(t.table_number, 0);
    for (const e of seated) {
      if (occupancy.has(e.table_number)) occupancy.set(e.table_number, occupancy.get(e.table_number) + 1);
    }

    const assignments = [];
    for (const entry of toSeat) {
      // Pick the least-occupied table that still has an open seat.
      let target = null;
      let best = Infinity;
      for (const [tableNumber, seats] of seatsByTable) {
        if (seats.length === 0) continue;
        const occ = occupancy.get(tableNumber) || 0;
        if (occ < best) { best = occ; target = tableNumber; }
      }
      if (target === null) break;
      const seat = seatsByTable.get(target).pop();
      occupancy.set(target, (occupancy.get(target) || 0) + 1);
      assignments.push({
        entry_id: entry.id,
        player_name: entry.player_name,
        table_number: seat.table_number,
        seat_number: seat.seat_number
      });
    }

    // Apply assignments. Sequential batched updates; each is a single-row write.
    const chips = tournament.starting_chips || 0;
    const errors = [];
    for (const a of assignments) {
      const { error } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          table_number: a.table_number,
          seat_number: a.seat_number,
          status: 'seated',
          current_chips: chips > 0 ? chips : undefined
        })
        .eq('id', a.entry_id)
        .eq('tournament_id', tournamentId);
      if (error) errors.push({ entry_id: a.entry_id, message: error.message });
    }

    await logAction({ action: 'seat_draw', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: tournamentId,
      targetType: 'commander_tournaments',
      targetName: tournament.name,
      metadata: { players_drawn: assignments.length, tables_used: tables.length, errors: errors.length },
      req
    });

    return res.status(200).json({
      success: true,
      data: {
        assignments,
        tables_used: tables.map(t => t.table_number),
        players_drawn: assignments.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Seat Draw Complete. ${assignments.length} Players Seated Across ${tables.length} Tables.`
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[seat-draw.js] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Seat Draw Failed' }
      });
    }
  }
}
