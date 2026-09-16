/**
 * End Of Day / Bag And Tag API
 * POST /api/commander/tournaments/[id]/bag-and-tag
 *
 * Closes a day of a multi-day tournament:
 *  1. Every surviving player is set to status 'bagged'.
 *  2. Their chip count is recorded in commander_tournaments.day_end_chip_counts
 *     (jsonb object keyed by entry_id) together with the table and seat the
 *     stack was counted at, so the count can be verified in the morning.
 *  3. Their table_number / seat_number are cleared. Nobody is sitting anywhere
 *     overnight, and leaving a seat claimed would make every occupancy check
 *     (auto-break, balance, open-seat search) believe the chair is taken.
 *  4. The tournament is set to 'paused'. 'paused' is the only value in the
 *     commander_tournaments status CHECK that means "this event is alive but
 *     not playing" - there is no 'bagged' or 'day_end' status and inventing
 *     one would be rejected by the constraint.
 *  5. The tournament's commander_tables are released back to the room, using
 *     the same release shape as tournamentAutoBreak.js, because the room needs
 *     those tables for cash games overnight.
 *  6. A print job of bag tags is queued for the floor print station.
 *
 * Body: { entry_ids?: string[] }  (default: every seated/active player)
 *
 * IMPORTANT: current_chips is deliberately NOT cleared. A bagged player is
 * still in the tournament and their stack still counts toward total chips,
 * average stack and the chip counts board. Only the seat goes away.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../src/lib/commander/audit';
import { enqueuePrintJob } from '../../../../src/lib/commander/printQueue';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';
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

/**
 * day_end_chip_counts shipped with a `'[]'::jsonb` default and the archived
 * design stored an array. We store an object keyed by entry_id so a second
 * day's bag never has to scan for and replace an earlier row for the same
 * player. Normalise whatever is already in the column before merging.
 */
function normalizeChipCounts(raw) {
  if (Array.isArray(raw)) {
    const out = {};
    for (const row of raw) {
      const key = row?.entry_id;
      if (!key) continue;
      out[String(key)] = {
        player_name: row.player_name ?? null,
        chips: Number(row.chips ?? row.chip_count) || 0,
        day: Number(row.day) || null,
        table_number: row.table_number ?? null,
        seat_number: row.seat_number ?? null,
        bagged_at: row.bagged_at ?? null
      };
    }
    return out;
  }
  if (raw && typeof raw === 'object') return { ...raw };
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
      .select('id, venue_id, name, status, is_multi_day, total_days, current_day, flight_label, resume_time, day_end_chip_counts')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tErr) {
      console.error('[bag-and-tag] tournament read failed', {
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

    // Venue scope: a signed staff session for one room must never be able to
    // close the day on another room's event.
    // One shared check. This was one of three hand-written spellings, and
    // this one fell OPEN on a null or 0 venue_id.
    if (denyCrossVenue(res, staff, tournament)) return;

    if (!tournament.is_multi_day) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NOT_MULTI_DAY',
          message: 'This Is Not A Multi-Day Tournament. Bag And Tag Only Applies To An Event That Continues On Another Day.'
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

    // Optional subset. Anything that is not a non-empty string is dropped
    // rather than sent to PostgREST as a malformed uuid filter.
    const requestedIds = Array.isArray(req.body?.entry_ids)
      ? [...new Set(req.body.entry_ids.filter(v => typeof v === 'string' && v.trim().length > 0))]
      : null;
    if (requestedIds && requestedIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'entry_ids Was Sent But Held No Valid Entry.' }
      });
    }

    let entryQuery = getSupabase()
      .from('commander_tournament_entries')
      .select('id, player_id, player_name, status, table_number, seat_number, current_chips, metadata')
      .eq('tournament_id', tournamentId)
      // Everyone still ALIVE in the event gets bagged, and 'registered' is
      // alive: rooms run the day with players still in that status (52 such
      // rows in production hold a table and seat). Leaving them out meant a
      // player physically at a table at the end of Day 1 was never bagged -
      // no bagged_chips, missing from day_end_chip_counts, and still holding
      // their chair overnight so the room could not release the table.
      .in('status', LIVE_SEAT_STATUSES)
      .limit(5000);
    if (requestedIds) entryQuery = entryQuery.in('id', requestedIds);

    const { data: entries, error: eErr } = await entryQuery;
    if (eErr) {
      console.error('[bag-and-tag] entries read failed', {
        tournamentId, code: eErr.code, message: eErr.message, details: eErr.details
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed To Read Tournament Entries' }
      });
    }

    const toBag = entries || [];
    if (toBag.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_PLAYERS_TO_BAG',
          message: 'No Seated Players To Bag. Everyone Is Already Bagged Or Eliminated.'
        }
      });
    }

    // ── Bag each player ──
    const baggedAt = new Date().toISOString();
    const chipCounts = normalizeChipCounts(tournament.day_end_chip_counts);
    const bagged = [];
    const errors = [];

    for (const e of toBag) {
      const chips = Number(e.current_chips) || 0;
      const { error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          status: 'bagged',
          // Nobody holds a chair overnight. Every occupancy check in the app
          // reads table_number/seat_number, so leaving these set would keep
          // the seat blocked for the whole break between days.
          table_number: null,
          seat_number: null,
          metadata: {
            ...(e.metadata || {}),
            bagged_at: baggedAt,
            bagged_day: currentDay,
            bagged_chips: chips,
            bagged_from: { table: e.table_number, seat: e.seat_number }
          }
        })
        .eq('id', e.id)
        .eq('tournament_id', tournamentId)
        // Status predicate makes a double-tap safe: only a player who is still
        // in the event can be bagged, so a second request writes zero rows
        // instead of re-stamping a fresh bag time over the real one. Must
        // match the selection set above or the write silently skips rows the
        // read returned.
        .in('status', LIVE_SEAT_STATUSES);

      if (uErr) {
        // This write NULLs the seat, so it sits outside both partial unique
        // indexes and cannot collide on a chair. The classifier is still used
        // so every batch route in the tournament path reports failures with the
        // same vocabulary, and so a future schema change cannot make this the
        // one route that hands the floor a raw Postgres string.
        const row = rowConflict(uErr, {
          entryId: e.id,
          playerName: e.player_name,
          action: 'Bag And Tag'
        });
        errors.push({ ...row, message: row.error });
        continue;
      }

      chipCounts[String(e.id)] = {
        player_name: e.player_name || null,
        chips,
        day: currentDay,
        table_number: e.table_number ?? null,
        seat_number: e.seat_number ?? null,
        bagged_at: baggedAt
      };
      bagged.push({
        entry_id: e.id,
        player_name: e.player_name,
        table_number: e.table_number,
        seat_number: e.seat_number,
        chips
      });
    }

    if (bagged.length === 0) {
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'No Player Could Be Bagged. Nothing Was Changed.' }
      });
    }

    // ── Persist the chip counts and pause the event ──
    const { error: tUpdateErr } = await getSupabase()
      .from('commander_tournaments')
      .update({
        day_end_chip_counts: chipCounts,
        status: 'paused'
      })
      .eq('id', tournamentId);

    if (tUpdateErr) {
      // The entries are already bagged. Say so loudly rather than reporting a
      // clean close: without the stored counts the morning has no record of
      // what anybody bagged beyond the printed tags.
      console.error('[bag-and-tag] tournament update failed', {
        tournamentId, code: tUpdateErr.code, message: tUpdateErr.message, details: tUpdateErr.details
      });
      return res.status(500).json({
        success: false,
        error: {
          code: 'DB_ERROR',
          message: `${bagged.length} Players Were Bagged But The End Of Day Chip Counts Could Not Be Saved. Do Not Close The Room, Record The Counts Manually.`
        }
      });
    }

    // ── Release the tables back to the room ──
    // Only when the whole field is down. If the TD bagged a subset (a single
    // flight finishing early, say) other players are still sitting and taking
    // their tables away would orphan them.
    let tablesReleased = 0;
    const { count: stillSeated, error: seatedErr } = await getSupabase()
      .from('commander_tournament_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      // Same set as the bag selection, so "any left to bag" agrees with it.
      .in('status', LIVE_SEAT_STATUSES);

    // A discarded error here reads as a count of null, which is falsy, and the
    // tables would be released out from under players who are still sitting.
    // On a read failure the safe answer is to leave the tables assigned.
    if (seatedErr) {
      console.error('[bag-and-tag] remaining-seated check failed', {
        tournamentId, code: seatedErr.code, message: seatedErr.message, details: seatedErr.details
      });
    } else if (!stillSeated) {
      // Same release shape as tournamentAutoBreak.js. commander_tables has NO
      // updated_at column - including one makes PostgREST reject the UPDATE
      // and the tables are never freed.
      const { data: released, error: relErr } = await getSupabase()
        .from('commander_tables')
        .update({
          mode: 'inactive',
          table_purpose: null,
          tournament_id: null,
          game_type: null,
          stakes: null,
          status: 'available',
          assigned_at: null,
          assigned_by: null
        })
        .eq('venue_id', tournament.venue_id)
        .eq('tournament_id', tournamentId)
        .select('id');

      if (relErr) {
        console.warn('[bag-and-tag] table release failed:', relErr.message);
      } else {
        tablesReleased = (released || []).length;
      }
    }

    // ── Queue the bag tags ──
    let venueName = '';
    let venueLogoUrl = null;
    let venueCity = null;
    let venueState = null;
    if (tournament.venue_id) {
      // poker_venues, not `venues`: commander_tournaments.venue_id is an
      // INTEGER FK to poker_venues.
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

    const receipts = bagged.map(b => ({
      receipt_kind: 'bag_tag',
      venue_name: venueName,
      venue_logo_url: venueLogoUrl,
      venue_city: venueCity,
      venue_state: venueState,
      tournament_name: tournament.name,
      flight_label: tournament.flight_label || null,
      day: currentDay,
      total_days: totalDays,
      player_name: b.player_name,
      table_number: b.table_number,
      seat_number: b.seat_number,
      chips: b.chips,
      resume_time: tournament.resume_time || null,
      timestamp: baggedAt
    }));

    // job_type 'custom': commander_print_jobs_job_type_check has no 'bag_tag'
    // value and inventing one would be rejected. receiptTemplates dispatches
    // on receipt_kind instead.
    const job = await enqueuePrintJob(getSupabase(), {
      venueId: tournament.venue_id,
      tournamentId,
      jobType: 'custom',
      receipts,
      title: `Chip Bag Tags, Day ${currentDay}, ${receipts.length} Player${receipts.length === 1 ? '' : 's'}`,
      source: 'bag_and_tag',
      createdBy: staff.id || null,
      meta: { day: currentDay, total_days: totalDays }
    });

    await logAction({ action: 'bag_and_tag', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: tournamentId,
      targetType: 'commander_tournaments',
      targetName: tournament.name,
      metadata: {
        day: currentDay,
        players_bagged: bagged.length,
        tables_released: tablesReleased,
        total_chips: bagged.reduce((sum, b) => sum + (b.chips || 0), 0),
        errors: errors.length,
        write_collisions: countCollisions(errors)
      },
      req
    });

    return res.status(200).json({
      // A partial bag is NOT a success: some players are still holding seats
      // and the TD has to see which ones failed.
      success: errors.length === 0,
      data: {
        day: currentDay,
        total_days: totalDays,
        players_bagged: bagged.length,
        tables_released: tablesReleased,
        total_chips: bagged.reduce((sum, b) => sum + (b.chips || 0), 0),
        bagged,
        print_job_id: job?.id || null,
        players_failed: errors.length,
        write_collisions: countCollisions(errors),
        errors: errors.length > 0 ? errors : undefined,
        message: errors.length === 0
          ? `Day ${currentDay} Closed. ${bagged.length} Player${bagged.length === 1 ? '' : 's'} Bagged, ${tablesReleased} Table${tablesReleased === 1 ? '' : 's'} Released. Bag Tags Are Waiting At The Print Station.`
          : `Day ${currentDay} Partially Closed. ${bagged.length} Bagged, ${errors.length} Failed. Check The Failures Before Releasing The Room.`
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[bag-and-tag] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Bag And Tag Failed' }
      });
    }
  }
}
