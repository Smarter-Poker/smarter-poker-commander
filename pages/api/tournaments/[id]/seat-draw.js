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
import { rowConflict, countCollisions } from '../../../../src/lib/commander/dbErrors';
import { denyCrossVenue } from '../../../../src/lib/commander/venueScope';
import { LIVE_SEAT_STATUSES } from '../../../../src/lib/commander/tournamentSeating';

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
    
    // Venue scope: a valid session for one room must never reach
    // another room's tournament. See src/lib/commander/venueScope.js.
    if (denyCrossVenue(res, staff, tournament)) return;
    if (!['scheduled', 'registration', 'registering', 'running', 'paused'].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Seat Draw Is Not Available For This Tournament Status' }
      });
    }

    // Entries: seated players hold their seats; registered players get drawn.
    // 'bagged' is deliberately NOT here. A bagged field belongs to a multi-day
    // event and is brought back by resume-day.js, which restores each player's
    // bagged chip count as it seats them. This route would seat them with
    // whatever stack happened to be on the row and would not advance the day.
    const { data: allEntries, error: entriesErr } = await getSupabase()
      .from('commander_tournament_entries')
      .select('id, player_name, status, table_number, seat_number, current_chips')
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'seated', 'active'])
      .limit(5000);

    // A discarded read error here looked exactly like an empty field and the TD
    // was told "Every Entry Already Has A Seat" when nothing had been read.
    if (entriesErr) {
      console.error('[seat-draw.js] entries read failed', {
        tournamentId, code: entriesErr.code, message: entriesErr.message, details: entriesErr.details,
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed To Read Tournament Entries' }
      });
    }

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
    //
    // 2026-08-20 audit fix: this filtered `.neq('status', 'closed')`, but
    // commander_tables_status_check only allows available/in_use/reserved/
    // maintenance. 'closed' belongs to the LEGACY `tables` table, not this one,
    // so the predicate excluded nothing and merely read as if it did.
    //
    // The real "do not seat players here" state is 'maintenance' (a broken or
    // pulled table). 'reserved' is deliberately still included: a room that
    // reserves a table for this tournament (final table, overflow) still wants
    // the draw to use it, and excluding it would start dropping tables that
    // were included before today. Assignment sets status to 'in_use' anyway
    // (see tables.js handleAssign), so in practice only a hand-edited row is
    // anything else.
    //
    // The `status.is.null` leg matters: status is nullable, and a bare
    // `.neq('status', ...)` evaluates to NULL for a null status and would
    // silently drop that table out of the draw.
    let tables = [];
    const { data: dbTables, error: tablesErr } = await getSupabase()
      .from('commander_tables')
      .select('table_number, max_seats')
      .eq('venue_id', tournament.venue_id)
      .eq('tournament_id', tournamentId)
      .or('status.is.null,status.neq.maintenance')
      .order('table_number', { ascending: true })
      .limit(200);

    // A discarded error here is worse than it looks: the code falls through to
    // synthesizing tables 1..N, so a transient read failure would seat the
    // whole field at table numbers that may not exist in the physical room.
    if (tablesErr) {
      console.error('[seat-draw.js] commander_tables read failed', {
        tournamentId, venueId: tournament.venue_id,
        code: tablesErr.code, message: tablesErr.message, details: tablesErr.details,
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed To Read The Tournament Table List' }
      });
    }

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
      // 2026-08-20 audit fix: `usedNumbers` was built and then never consulted -
      // the loop always synthesized 1..N. If seated players were parked on a
      // table OUTSIDE that range (say table 5 with 1..3 synthesized) their table
      // was excluded from the pool, its open seats were never offered, and the
      // draw could fail NOT_ENOUGH_SEATS with a half-empty room. Seed the pool
      // with the tables that already hold players, then top up.
      const usedNumbers = [...new Set(seated.map(e => e.table_number).filter(Boolean))]
        .sort((a, b) => a - b);
      for (const tn of usedNumbers) tables.push({ table_number: tn, max_seats: perTable });

      const taken = new Set(usedNumbers);
      let n = 1;
      while (tables.length < needed) {
        while (taken.has(n)) n++;
        tables.push({ table_number: n, max_seats: perTable });
        taken.add(n);
        n++;
      }
      tables.sort((a, b) => a.table_number - b.table_number);
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

    // Re-verify every drawn seat is STILL empty immediately before writing.
    // The draw reads the field, shuffles in memory, then writes; a concurrent
    // register.js auto-seat (which claims a seat through
    // commander_claim_open_seat) can take one of these seats inside that window
    // and the draw would silently double-seat the table. Aborting is correct
    // here: a seat draw is a single deliberate TD action and re-running it is
    // cheap, whereas two players on one seat is a floor incident.
    const drawnTables = [...new Set(assignments.map(a => a.table_number))];
    if (drawnTables.length > 0) {
      const { data: liveSeats, error: liveErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, table_number, seat_number, player_name')
        .eq('tournament_id', tournamentId)
        // SEAT OCCUPANCY: LIVE_SEAT_STATUSES mirrors the uq_commander_entries_live_seat
        // index exactly. 'registered' holds a chair - omitting it made this probe
        // report a taken seat as free, and the index then raised a 23505 the floor
        // saw as a phantom "another device filled it first". 'bagged' holds none.
                .in('status', LIVE_SEAT_STATUSES)
        .in('table_number', drawnTables);

      if (liveErr) {
        console.error('[seat-draw.js] seat re-verification failed', {
          tournamentId, code: liveErr.code, message: liveErr.message, details: liveErr.details,
        });
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: 'Failed To Verify Drawn Seats' }
        });
      }

      const drawnIds = new Set(assignments.map(a => a.entry_id));
      const taken = (liveSeats || []).find(e =>
        !drawnIds.has(e.id) &&
        assignments.some(a => a.table_number === e.table_number && a.seat_number === e.seat_number)
      );
      if (taken) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'SEAT_OCCUPIED',
            message: `Draw Aborted: Seat ${taken.seat_number} At Table ${taken.table_number} Was Taken By ${taken.player_name || 'Another Player'}. Run The Draw Again.`
          }
        });
      }
    }

    // Apply assignments. Sequential batched updates; each is a single-row write.
    // Chips are granted ONLY to entries that do not have a stack yet. A player
    // who already has chips (already active, or rebought before the draw ran)
    // must never be reset to the starting stack by a seat draw. Likewise an
    // already-'active' player keeps that status rather than being demoted.
    const chips = tournament.starting_chips || 0;
    const errors = [];
    for (const a of assignments) {
      const source = toSeat.find(e => e.id === a.entry_id);
      const hasChips = Number(source?.current_chips) > 0;
      const payload = {
        table_number: a.table_number,
        seat_number: a.seat_number,
        status: source?.status === 'active' ? 'active' : 'seated'
      };
      if (!hasChips && chips > 0) payload.current_chips = chips;

      const { error } = await getSupabase()
        .from('commander_tournament_entries')
        .update(payload)
        .eq('id', a.entry_id)
        .eq('tournament_id', tournamentId);
      // One player's collision must NOT abort the draw. The rest of the field
      // still gets seated and the failures are reported row by row.
      // uq_commander_entries_live_seat rejects a chair that was claimed after
      // the re-verification pass above, which is exactly the case rowConflict
      // labels as a collision.
      if (error) {
        const row = rowConflict(error, {
          entryId: a.entry_id,
          playerName: a.player_name,
          tableNumber: a.table_number,
          seatNumber: a.seat_number,
          action: 'Seat Draw'
        });
        // `message` is the field this route has always used; `error` and
        // `collision` are the shared shape. Both are sent so the TD screen keeps
        // rendering and new clients can count collisions.
        errors.push({ ...row, message: row.error });
      }
    }

    const collided = countCollisions(errors);

    await logAction({ action: 'seat_draw', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: tournamentId,
      targetType: 'commander_tournaments',
      targetName: tournament.name,
      metadata: {
        players_drawn: assignments.length,
        tables_used: tables.length,
        errors: errors.length,
        seat_collisions: collided
      },
      req
    });

    return res.status(200).json({
      // A partial draw is NOT a success - some players were left unseated and
      // the TD must be shown the failures rather than a green checkmark.
      success: errors.length === 0,
      data: {
        assignments,
        tables_used: tables.map(t => t.table_number),
        players_drawn: assignments.length - errors.length,
        players_failed: errors.length,
        seat_collisions: collided,
        errors: errors.length > 0 ? errors : undefined,
        message: errors.length === 0
          ? `Seat Draw Complete. ${assignments.length} Players Seated Across ${tables.length} Tables.`
          : `Seat Draw Partially Applied. ${assignments.length - errors.length} Of ${assignments.length} Players Seated, ${errors.length} Failed${collided > 0 ? `, ${collided} Because The Seat Was Already Taken` : ''}. Fix Those Players, Then Run The Draw Again.`
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
