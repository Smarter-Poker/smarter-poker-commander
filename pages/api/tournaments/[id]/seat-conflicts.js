/**
 * Seat Conflict Repair API
 * GET  /api/commander/tournaments/[id]/seat-conflicts
 *      Lists every seat held by more than one live player.
 * POST /api/commander/tournaments/[id]/seat-conflicts
 *      body { action: 'resolve_all' } or { action: 'resolve', entry_id }
 *      Moves the LATER-seated player(s) off a contested seat into a real open
 *      seat, leaving the earliest occupant in place.
 *
 * WHY: seats used to be assigned read-then-write (find a gap, then update in a
 * separate statement), so two concurrent promotions, or a promotion racing a
 * late registration, could hand out the same chair. Production held 53 such
 * duplicates across live tournaments. New assignments go through the atomic
 * commander_claim_open_seat RPC, but the historic conflicts still need
 * clearing, and a floor person cannot fix them by hand without knowing which
 * of the two players arrived first.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../src/lib/commander/audit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { claimOpenSeat } from '../../../../src/lib/commander/tournamentSeating';
import { rowConflict, countCollisions, isUniqueViolation, conflictError } from '../../../../src/lib/commander/dbErrors';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// SEAT OCCUPANCY. Two players can only fight over a chair if both are IN one,
// so 'bagged' (multi-day, chips in a bag, no seat) is deliberately excluded.
// 'registered' IS included: a player seated before the clock starts keeps that
// status until play begins, and production has 52 such entries holding real
// seats. Leaving them out hid every pre-start double-booking, which is the
// exact case this tool exists to find.
const LIVE_STATUSES = ['registered', 'seated', 'active'];

async function loadConflicts(tournamentId) {
  const { data, error } = await getSupabase()
    .from('commander_tournament_entries')
    .select('id, player_name, table_number, seat_number, status, current_chips, registered_at, created_at')
    .eq('tournament_id', tournamentId)
    .in('status', LIVE_STATUSES)
    .not('table_number', 'is', null)
    .not('seat_number', 'is', null)
    .limit(5000);

  if (error) throw error;

  const bySeat = new Map();
  for (const e of data || []) {
    const key = `${e.table_number}:${e.seat_number}`;
    if (!bySeat.has(key)) bySeat.set(key, []);
    bySeat.get(key).push(e);
  }

  const conflicts = [];
  for (const [key, occupants] of bySeat) {
    if (occupants.length < 2) continue;
    // Earliest registration keeps the seat; everyone after them moves.
    const sorted = [...occupants].sort((a, b) =>
      new Date(a.registered_at || a.created_at || 0) - new Date(b.registered_at || b.created_at || 0));
    const [table_number, seat_number] = key.split(':').map(Number);
    conflicts.push({
      table_number,
      seat_number,
      keeps_seat: {
        entry_id: sorted[0].id,
        player_name: sorted[0].player_name,
        current_chips: sorted[0].current_chips
      },
      must_move: sorted.slice(1).map(e => ({
        entry_id: e.id,
        player_name: e.player_name,
        current_chips: e.current_chips
      }))
    });
  }
  return conflicts;
}

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else if (!applyRateLimit(req, res, LIMITS.read)) return;

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
    if (staff.venue_id && Number(staff.venue_id) !== Number(tournament.venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'WRONG_VENUE', message: 'Tournament Belongs To A Different Venue' }
      });
    }

    if (req.method === 'GET') {
      const conflicts = await loadConflicts(tournamentId);
      return res.status(200).json({
        success: true,
        data: {
          conflicts,
          conflict_count: conflicts.length,
          players_to_move: conflicts.reduce((n, c) => n + c.must_move.length, 0)
        }
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
      });
    }

    const action = req.body?.action || 'resolve_all';
    if (!['resolve_all', 'resolve'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'action Must Be resolve_all Or resolve' }
      });
    }

    const conflicts = await loadConflicts(tournamentId);
    if (conflicts.length === 0) {
      return res.status(200).json({
        success: true,
        data: { resolved: [], failed: [], message: 'No Seat Conflicts Found.' }
      });
    }

    // Which entries need moving.
    let targets = [];
    if (action === 'resolve') {
      const entryId = req.body?.entry_id;
      if (!entryId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'entry_id Is Required For A Single Resolve' }
        });
      }
      for (const c of conflicts) {
        const hit = c.must_move.find(m => String(m.entry_id) === String(entryId));
        if (hit) targets.push({ ...hit, from_table: c.table_number, from_seat: c.seat_number });
      }
      if (targets.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NOT_CONFLICTED',
            message: 'That Entry Is Not The Later Occupant Of A Contested Seat.'
          }
        });
      }
    } else {
      for (const c of conflicts) {
        for (const m of c.must_move) {
          targets.push({ ...m, from_table: c.table_number, from_seat: c.seat_number });
        }
      }
    }

    const resolved = [];
    const failed = [];
    for (const t of targets) {
      // Clear the contested seat first so the atomic claim cannot hand the
      // player back the seat they are sitting in.
      const { error: clearErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({ table_number: null, seat_number: null })
        .eq('id', t.entry_id)
        .eq('tournament_id', tournamentId)
        .in('status', LIVE_STATUSES);

      // One row's failure must not abort the repair sweep: the remaining
      // conflicts still get cleared.
      if (clearErr) {
        failed.push(rowConflict(clearErr, {
          entryId: t.entry_id,
          playerName: t.player_name,
          tableNumber: t.from_table,
          seatNumber: t.from_seat,
          action: 'Seat Conflict Repair'
        }));
        continue;
      }

      const seat = await claimOpenSeat(getSupabase(), tournamentId, t.entry_id);
      if (!seat) {
        // Put them back rather than leaving a live player with no seat at all.
        // With uq_commander_entries_live_seat in place this restore can itself
        // be rejected: the earliest occupant is still in that chair, which is
        // precisely the conflict being repaired. Report it instead of leaving
        // the floor believing the player was put back.
        const { error: restoreErr } = await getSupabase()
          .from('commander_tournament_entries')
          .update({ table_number: t.from_table, seat_number: t.from_seat })
          .eq('id', t.entry_id)
          .eq('tournament_id', tournamentId);

        failed.push({
          entry_id: t.entry_id,
          player_name: t.player_name,
          code: 'NO_OPEN_SEATS',
          collision: false,
          error: restoreErr
            ? `No Open Seat Available, And ${t.player_name || 'The Player'} Could Not Be Put Back At Table ${t.from_table} Seat ${t.from_seat}. They Are Currently Unseated. Add A Table Or Break One, Then Seat Them By Hand.`
            : 'No Open Seat Available. Add A Table Or Break One First.'
        });
        continue;
      }

      resolved.push({
        entry_id: t.entry_id,
        player_name: t.player_name,
        from_table: t.from_table,
        from_seat: t.from_seat,
        to_table: seat.table_number,
        to_seat: seat.seat_number,
        chips: t.current_chips
      });
    }

    // Queue seat change cards so the moved players get told where to sit.
    let printJobId = null;
    if (resolved.length > 0) {
      const { data: venue } = await getSupabase()
        .from('poker_venues')
        .select('name, city, state')
        .eq('id', tournament.venue_id)
        .maybeSingle();

      const receipts = resolved.map(r => ({
        venue_name: venue?.name || 'Club',
        venue_city: venue?.city || null,
        venue_state: venue?.state || null,
        tournament_name: tournament.name,
        player_name: r.player_name,
        from_table: r.from_table,
        from_seat: r.from_seat,
        to_table: r.to_table,
        to_seat: r.to_seat,
        chips: r.chips,
        timestamp: new Date().toISOString()
      }));

      const { data: job } = await getSupabase()
        .from('commander_print_jobs')
        .insert({
          venue_id: tournament.venue_id,
          tournament_id: tournamentId,
          job_type: 'seat_change',
          status: 'queued',
          title: `${receipts.length} Seat Conflict Move(s)`,
          payload: { receipts },
          receipt_count: receipts.length,
          source: 'seat_conflict_repair',
          created_by: staff.id || null
        })
        .select('id')
        .maybeSingle();
      printJobId = job?.id || null;
    }

    await logAction({ action: 'resolve_seat_conflicts', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: tournamentId,
      targetType: 'commander_tournaments',
      targetName: tournament.name,
      metadata: { resolved: resolved.length, failed: failed.length, seat_collisions: countCollisions(failed) },
      req
    });

    return res.status(200).json({
      success: failed.length === 0,
      data: {
        resolved,
        resolved_count: resolved.length,
        failed_count: failed.length,
        seat_collisions: countCollisions(failed),
        failed: failed.length > 0 ? failed : undefined,
        print_job_id: printJobId,
        message: failed.length === 0
          ? `${resolved.length} Player(s) Moved To Open Seats. Cards Queued At The Print Station.`
          : `${resolved.length} Moved, ${failed.length} Could Not Be Moved. Check The Failure List Before Restarting Play.`
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[seat-conflicts] Error:', err);
    if (!res.headersSent) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ success: false, error: conflictError(err, { action: 'Seat Conflict Repair' }) });
      }
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed To Resolve Seat Conflicts' }
      });
    }
  }
}
