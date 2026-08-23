/**
 * Day 2 Resume API
 * POST /api/commander/tournaments/[id]/resume-day
 *
 * The other half of bag-and-tag. Brings the bagged field back to the tables:
 *  1. Every 'bagged' entry is restored to 'seated' with the chip count that
 *     was recorded when they bagged (commander_tournaments.day_end_chip_counts,
 *     falling back to the copy stamped on the entry's metadata, then to the
 *     stack still on the row).
 *  2. A fresh RANDOM seat draw is run across the tables currently assigned to
 *     the tournament. Same balanced round-robin fill as seat-draw.js: the
 *     least-occupied table is offered first so no table starts short-handed,
 *     and the seat within a table is random.
 *  3. current_day is advanced and the tournament goes back to 'running'.
 *  4. Seat assignment cards are queued for the floor print station so a
 *     returning player can be told where to sit without the TD reading a list
 *     out loud.
 *
 * Body: { day?: number }  (default: current_day + 1)
 *
 * Refuses when there is nothing bagged, or when no table is assigned - the
 * bag-and-tag that closed the previous day RELEASED the tables back to the
 * room, so the floor has to assign them again before the field can sit down.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../src/lib/commander/audit';
import { enqueuePrintJob } from '../../../../src/lib/commander/printQueue';
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

/** day_end_chip_counts is stored keyed by entry_id, but older rows are arrays. */
function chipCountsByEntry(raw) {
  if (Array.isArray(raw)) {
    const out = {};
    for (const row of raw) {
      if (!row?.entry_id) continue;
      out[String(row.entry_id)] = row;
    }
    return out;
  }
  if (raw && typeof raw === 'object') return raw;
  return {};
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
    if (!tournamentId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' }
      });
    }

    const { data: tournament, error: tErr } = await getSupabase()
      .from('commander_tournaments')
      .select('id, venue_id, name, status, is_multi_day, total_days, current_day, flight_label, buyin_amount, day_end_chip_counts')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tErr) {
      console.error('[resume-day] tournament read failed', {
        tournamentId, code: tErr.code, message: tErr.message, details: tErr.details
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed To Read The Tournament' }
      });
    }
    if (!tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }

    // One shared check. This was one of three hand-written spellings, and
    // this one fell OPEN on a null or 0 venue_id.
    if (denyCrossVenue(res, staff, tournament)) return;

    if (!tournament.is_multi_day) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NOT_MULTI_DAY',
          message: 'This Is Not A Multi-Day Tournament. There Is No Day To Resume.'
        }
      });
    }
    if (['completed', 'cancelled'].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: 'This Tournament Has Already Finished' }
      });
    }

    const currentDay = Number(tournament.current_day) || 1;
    const totalDays = Number(tournament.total_days) || null;
    const requestedDay = Number(req.body?.day);
    let targetDay = Number.isInteger(requestedDay) && requestedDay > 0
      ? requestedDay
      : currentDay + 1;
    if (totalDays && targetDay > totalDays) targetDay = totalDays;

    // ── Who is coming back ──
    const { data: baggedEntries, error: eErr } = await getSupabase()
      .from('commander_tournament_entries')
      .select('id, player_id, player_name, status, current_chips, metadata')
      .eq('tournament_id', tournamentId)
      .eq('status', 'bagged')
      .limit(5000);

    if (eErr) {
      console.error('[resume-day] bagged entries read failed', {
        tournamentId, code: eErr.code, message: eErr.message, details: eErr.details
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed To Read Tournament Entries' }
      });
    }

    const returning = baggedEntries || [];
    if (returning.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_BAGGED_ENTRIES',
          message: 'No Bagged Players To Bring Back. Run End Day, Bag And Tag First.'
        }
      });
    }

    // ── Tables ──
    // Read commander_tables directly. bag-and-tag released them, so this is
    // the check that tells the floor to assign tables again.
    const { data: dbTables, error: tblErr } = await getSupabase()
      .from('commander_tables')
      .select('table_number, max_seats')
      .eq('venue_id', tournament.venue_id)
      .eq('tournament_id', tournamentId)
      .order('table_number', { ascending: true })
      .limit(200);

    if (tblErr) {
      console.error('[resume-day] tables read failed', {
        tournamentId, code: tblErr.code, message: tblErr.message, details: tblErr.details
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed To Read The Tournament Tables' }
      });
    }

    const tables = (dbTables || []).map(t => ({
      table_number: t.table_number,
      max_seats: Math.min(12, Math.max(2, Number(t.max_seats) || 9))
    }));

    if (tables.length < 1) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_TABLES_ASSIGNED',
          message: 'No Tables Are Assigned To This Tournament. Closing The Previous Day Released Them Back To The Room. Assign Tables First, Then Resume.'
        }
      });
    }

    // ── Occupancy ──
    // Anyone already holding a seat (a re-entry seated this morning, or a
    // player the floor placed by hand) keeps it, exactly like seat-draw.js.
    // LIVE_SEAT_STATUSES mirrors uq_commander_entries_live_seat: a re-entry
    // registered this morning is 'registered' and holds a chair, so omitting
    // it made the resume draw hand that chair to somebody else.
    const { data: liveSeated, error: seatErr } = await getSupabase()
      .from('commander_tournament_entries')
      .select('id, table_number, seat_number, player_name')
      .eq('tournament_id', tournamentId)
      .in('status', LIVE_SEAT_STATUSES)
      .limit(5000);

    if (seatErr) {
      console.error('[resume-day] occupancy read failed', {
        tournamentId, code: seatErr.code, message: seatErr.message, details: seatErr.details
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed To Verify Open Seats' }
      });
    }

    const seated = (liveSeated || []).filter(e => e.table_number && e.seat_number);
    const occupied = new Set(seated.map(e => `${e.table_number}:${e.seat_number}`));

    const openSeats = [];
    for (const t of tables) {
      for (let s = 1; s <= t.max_seats; s++) {
        const key = `${t.table_number}:${s}`;
        if (!occupied.has(key)) openSeats.push({ table_number: t.table_number, seat_number: s });
      }
    }

    if (openSeats.length < returning.length) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NOT_ENOUGH_SEATS',
          message: `Only ${openSeats.length} Open Seats For ${returning.length} Returning Players. Assign More Tables And Retry.`
        }
      });
    }

    // ── Balanced random draw ──
    const seatsByTable = new Map();
    for (const seat of openSeats) {
      if (!seatsByTable.has(seat.table_number)) seatsByTable.set(seat.table_number, []);
      seatsByTable.get(seat.table_number).push(seat);
    }
    for (const [k, v] of seatsByTable) seatsByTable.set(k, shuffle(v));

    const occupancy = new Map(tables.map(t => [t.table_number, 0]));
    for (const e of seated) {
      if (occupancy.has(e.table_number)) occupancy.set(e.table_number, occupancy.get(e.table_number) + 1);
    }

    const storedCounts = chipCountsByEntry(tournament.day_end_chip_counts);
    const drawOrder = shuffle(returning);
    const assignments = [];

    for (const entry of drawOrder) {
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

      // Chip count, most trustworthy source first:
      //  1. current_chips on the entry. bag-and-tag never clears it, and a
      //     floor correction made while the player was bagged lands here.
      //  2. the tournament's day_end_chip_counts record for this entry.
      //  3. the copy stamped on the entry's own metadata at bag time.
      // 2 and 3 exist so a stack is still recoverable if something zeroed the
      // row overnight, which would otherwise seat a live player with nothing.
      const stored = storedCounts[String(entry.id)];
      const storedChips = Number(stored?.chips ?? stored?.chip_count);
      const metaChips = Number(entry.metadata?.bagged_chips);
      const liveChips = Number(entry.current_chips);
      const chips = Number.isFinite(liveChips) && liveChips > 0
        ? liveChips
        : (Number.isFinite(storedChips) && storedChips > 0
          ? storedChips
          : (Number.isFinite(metaChips) && metaChips > 0 ? metaChips : 0));

      assignments.push({
        entry_id: entry.id,
        player_name: entry.player_name,
        table_number: seat.table_number,
        seat_number: seat.seat_number,
        chips,
        metadata: entry.metadata || {}
      });
    }

    // Re-verify every drawn seat is STILL empty immediately before writing.
    // The draw reads, shuffles in memory, then writes; a concurrent seating
    // action can take one of these chairs inside that window. Aborting is
    // correct: re-running a resume draw is cheap, two players on one seat is
    // a floor incident.
    const drawnTables = [...new Set(assignments.map(a => a.table_number))];
    if (drawnTables.length > 0) {
      const { data: recheck, error: recheckErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, table_number, seat_number, player_name')
        .eq('tournament_id', tournamentId)
        // Same occupancy rule as the read above.
        .in('status', LIVE_SEAT_STATUSES)
        .in('table_number', drawnTables);

      if (recheckErr) {
        console.error('[resume-day] seat re-verification failed', {
          tournamentId, code: recheckErr.code, message: recheckErr.message, details: recheckErr.details
        });
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: 'Failed To Verify Drawn Seats' }
        });
      }

      const drawnIds = new Set(assignments.map(a => a.entry_id));
      const taken = (recheck || []).find(e =>
        !drawnIds.has(e.id) &&
        assignments.some(a => a.table_number === e.table_number && a.seat_number === e.seat_number)
      );
      if (taken) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'SEAT_OCCUPIED',
            message: `Draw Aborted: Seat ${taken.seat_number} At Table ${taken.table_number} Was Taken By ${taken.player_name || 'Another Player'}. Resume Again.`
          }
        });
      }
    }

    // ── Apply ──
    const resumedAt = new Date().toISOString();
    const seatedNow = [];
    const errors = [];

    for (const a of assignments) {
      const { error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          status: 'seated',
          table_number: a.table_number,
          seat_number: a.seat_number,
          current_chips: a.chips,
          metadata: {
            ...a.metadata,
            resumed_at: resumedAt,
            resumed_day: targetDay,
            resumed_chips: a.chips
          }
        })
        .eq('id', a.entry_id)
        .eq('tournament_id', tournamentId)
        // Only a still-bagged entry can be resumed, so a double-tap writes
        // zero rows instead of re-seating a player who already sat down.
        .eq('status', 'bagged');

      if (uErr) {
        // One returning player's collision must not abort the whole resume:
        // the rest of the field still sits down and the failures are listed
        // individually so the floor can place those players by hand.
        const row = rowConflict(uErr, {
          entryId: a.entry_id,
          playerName: a.player_name,
          tableNumber: a.table_number,
          seatNumber: a.seat_number,
          action: 'Day Resume'
        });
        // `message` is the field this route has always used; `error` and
        // `collision` are the shared shape.
        errors.push({ ...row, message: row.error });
      } else {
        seatedNow.push(a);
      }
    }

    const collided = countCollisions(errors);

    if (seatedNow.length === 0) {
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'No Player Could Be Seated. Nothing Was Changed.' }
      });
    }

    const { error: tUpdateErr } = await getSupabase()
      .from('commander_tournaments')
      .update({
        current_day: targetDay,
        status: 'running'
      })
      .eq('id', tournamentId);

    if (tUpdateErr) {
      console.error('[resume-day] tournament update failed', {
        tournamentId, code: tUpdateErr.code, message: tUpdateErr.message, details: tUpdateErr.details
      });
    }

    // ── Seat assignment cards ──
    let venueName = '';
    let venueLogoUrl = null;
    let venueCity = null;
    let venueState = null;
    if (tournament.venue_id) {
      const { data: venueRow } = await getSupabase()
        .from('poker_venues')
        .select('name, logo_url, city, state')
        .eq('id', tournament.venue_id)
        .maybeSingle();
      venueName = venueRow?.name || '';
      venueLogoUrl = venueRow?.logo_url || null;
      venueCity = venueRow?.city || null;
      venueState = venueRow?.state || null;
    }

    const receipts = seatedNow.map(a => ({
      venue_name: venueName,
      venue_logo_url: venueLogoUrl,
      venue_city: venueCity,
      venue_state: venueState,
      tournament_name: `${tournament.name} - Day ${targetDay}`,
      buyin_amount: tournament.buyin_amount || null,
      player_name: a.player_name,
      // A returning player is not moving FROM anywhere, so the moved-from line
      // is deliberately omitted rather than printed with blanks.
      from_table: null,
      from_seat: null,
      to_table: a.table_number,
      to_seat: a.seat_number,
      chips: a.chips,
      timestamp: resumedAt
    }));

    const job = await enqueuePrintJob(getSupabase(), {
      venueId: tournament.venue_id,
      tournamentId,
      jobType: 'seat_change',
      receipts,
      title: `Day ${targetDay} Seat Draw, ${receipts.length} Seat Card${receipts.length === 1 ? '' : 's'}`,
      source: 'resume_day',
      createdBy: staff.id || null,
      meta: { day: targetDay, total_days: totalDays }
    });

    await logAction({ action: 'resume_day', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: tournamentId,
      targetType: 'commander_tournaments',
      targetName: tournament.name,
      metadata: {
        day: targetDay,
        players_returned: seatedNow.length,
        tables_used: tables.length,
        errors: errors.length,
        seat_collisions: collided
      },
      req
    });

    return res.status(200).json({
      // A partial resume is NOT a success: some players have no seat.
      success: errors.length === 0,
      data: {
        day: targetDay,
        total_days: totalDays,
        players_returned: seatedNow.length,
        tables_used: tables.map(t => t.table_number),
        assignments: seatedNow.map(a => ({
          entry_id: a.entry_id,
          player_name: a.player_name,
          table_number: a.table_number,
          seat_number: a.seat_number,
          chips: a.chips
        })),
        print_job_id: job?.id || null,
        players_failed: errors.length,
        seat_collisions: collided,
        errors: errors.length > 0 ? errors : undefined,
        message: errors.length === 0
          ? `Day ${targetDay} Under Way. ${seatedNow.length} Player${seatedNow.length === 1 ? '' : 's'} Drawn Across ${tables.length} Table${tables.length === 1 ? '' : 's'}. Seat Cards Are Waiting At The Print Station.`
          : `Day ${targetDay} Partially Started. ${seatedNow.length} Of ${assignments.length} Players Seated, ${errors.length} Failed${collided > 0 ? `, ${collided} Because The Seat Was Already Taken` : ''}. Seat Those Players By Hand.`
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[resume-day] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Day Resume Failed' }
      });
    }
  }
}
