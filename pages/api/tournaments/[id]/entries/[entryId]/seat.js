/**
 * Seat Change API
 * PUT /api/commander/tournaments/[id]/entries/[entryId]/seat
 * Changes a player's seat (same table or different table)
 * Used for seat change requests and manual reassignment
 */
import { createClient } from '../../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../../src/lib/sentryWrap';
import { seatConflictResponse } from '../../../../../../src/lib/commander/dbErrors';
import { denyCrossVenue } from '../../../../../../src/lib/commander/venueScope';
import { LIVE_SEAT_STATUSES } from '../../../../../../src/lib/commander/tournamentSeating';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: any active staff session for THIS venue (guardStaff + denyCrossVenue).
// NOT role-gated. This header used to claim "requires manager or owner
// role"; neither guardStaff nor guardWriteStaff performs any role check,
// so every role in commander_staff - including dealer and brush - passes.
// Stated accurately rather than aspirationally: a comment that overstates
// the guard is worse than none, because the next reader trusts it.
// Whether the cash-taking routes SHOULD be manager-only is a product
// decision, not a bug fix - see .agent/audits/.
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'PUT') {
      res.setHeader('Allow', ['PUT']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const { id: tournamentId, entryId } = req.query;
    if (!tournamentId || !entryId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID And Entry ID Required' } });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      const { data: tournament } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id')
        .eq('id', tournamentId)
        .maybeSingle();
      if (!tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
      
      // Venue scope: a valid session for one room must never reach
      // another room's tournament. See src/lib/commander/venueScope.js.
      if (denyCrossVenue(res, _g, tournament)) return;


      const { table_number, seat_number } = req.body;
      // Both columns are INTEGER. A non-numeric body value used to reach
      // PostgREST and come back as an opaque 500; validate up front instead.
      const tableNum = Number(table_number);
      const seatNum = Number(seat_number);
      if (table_number === undefined || seat_number === undefined
        || !Number.isInteger(tableNum) || tableNum < 1
        || !Number.isInteger(seatNum) || seatNum < 1 || seatNum > 12) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A Whole-Number table_number And seat_number (1 To 12) Are Required' } });
      }

      const { data: entry } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (!entry) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entry Not Found' } });

      // Only live entries hold seats. Without this an eliminated or cancelled
      // player could be given a live seat that the floor then could not fill.
      // 'bagged' is permitted: this is the only route that puts a NAMED
      // returning player in a NAMED chair, which the floor needs when a Day 2
      // player has an accessibility requirement or arrives after the resume
      // draw has already run. The status is advanced to 'seated' below.
      if (!['registered', 'seated', 'active', 'alternate', 'bagged'].includes(entry.status)) {
        return res.status(400).json({ success: false, error: { code: 'PLAYER_NOT_ACTIVE', message: `Cannot Seat A Player With Status ${entry.status}` } });
      }

      // Check seat not occupied.
      // .maybeSingle() throws when two rows share the seat (exactly the state
      // this guard exists to catch) and the discarded error let the change through.
      const { data: existingRows, error: occErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_name')
        .eq('tournament_id', tournamentId)
        .eq('table_number', tableNum)
        .eq('seat_number', seatNum)
        // SEAT OCCUPANCY: only a player physically in the chair blocks it.
        // 'bagged' is deliberately excluded (bag-and-tag nulls their seat, so
        // they could not match anyway, and including it would keep a released
        // chair blocked forever).
        // 2026-08-20: 'registered' MUST be included. A player seated before the
        // clock starts keeps status 'registered' until play begins, and
        // production currently has 52 such entries holding real seats. Omitting
        // them made this probe report an occupied chair as free, so the TD
        // could assign two players to it, which is exactly the double-booking
        // the seat conflict repair tool exists to clean up.
        .in('status', LIVE_SEAT_STATUSES)
        .neq('id', entryId)
        .limit(1);

      if (occErr) {
        console.error('[tournaments/entries/seat] seat occupancy read failed', {
          tournamentId, code: occErr.code, message: occErr.message, details: occErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Verify Destination Seat' } });
      }

      const existing = (existingRows || [])[0];
      if (existing) {
        return res.status(409).json({
          success: false,
          error: { code: 'SEAT_OCCUPIED', message: `Seat ${seatNum} At Table ${tableNum} Occupied By ${existing.player_name}` }
        });
      }

      const fromTable = entry.table_number;
      const fromSeat = entry.seat_number;

      // A player who is given a seat is sitting in it, so the status must say
      // so. 'registered' (never seated), 'bagged' (returning from an overnight
      // break) and 'alternate' (called off the list into a named chair) all
      // advance to 'seated'.
      //
      // 'alternate' was missing, and it was the dangerous one. The partial
      // index that enforces one-player-per-seat covers only
      // ('registered','seated','active'), so an entry left as 'alternate'
      // while holding a table and seat is INVISIBLE to it - the database will
      // happily seat a second human in the same chair - and invisible to every
      // JS occupancy probe too. The seat renders empty on the floor map while
      // somebody is sitting in it, the player stays in the alternate queue and
      // keeps getting "You Are Nth In Line", and promoteNextAlternate can seat
      // them a second time elsewhere, silently blocking the first chair for
      // the rest of the event. promote.js already writes 'seated' here.
      const newStatus = ['registered', 'bagged', 'alternate'].includes(entry.status)
        ? 'seated'
        : entry.status;

      const { error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          table_number: tableNum,
          seat_number: seatNum,
          status: newStatus,
          metadata: {
            ...(entry.metadata || {}),
            last_moved_at: new Date().toISOString(),
            last_moved_from: { table: fromTable, seat: fromSeat },
            move_reason: 'seat_change'
          }
        })
        .eq('id', entryId)
        .eq('tournament_id', tournamentId);

      if (uErr) {
        // The occupancy probe above is a read, so a seat can still be filled
        // between that read and this write. uq_commander_entries_live_seat now
        // rejects the second writer with 23505 instead of double-booking the
        // chair; turn that into the same actionable 409 the probe returns.
        if (seatConflictResponse(res, uErr, { tableNumber: tableNum, seatNumber: seatNum, action: 'Seat Change' })) return;
        console.error('[tournaments/entries/seat] seat write failed', {
          tournamentId, entryId, code: uErr.code, message: uErr.message, details: uErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Change Seat' } });
      }

      return res.status(200).json({
        success: true,
        data: {
          entry_id: entryId,
          player_name: entry.player_name,
          from_table: fromTable,
          from_seat: fromSeat,
          to_table: tableNum,
          to_seat: seatNum
        }
      });
    } catch (err) {
      console.warn('Seat change error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
