/**
 * Move Player API
 * POST /api/commander/tournaments/[id]/move-player
 * Moves a tournament player to a different table and seat
 * Used by TD Tablet for table balancing and manual moves
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff, guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';
import { seatConflictResponse } from '../../../../src/lib/commander/dbErrors';
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

    // guardStaff, not guardWriteStaff. This route only accepts POST (it 405s
    // everything else immediately below), so the GET pass-through in
    // guardWriteStaff buys nothing here - it just means _g is the BOOLEAN true
    // on a path that can still be reached if the method check is ever moved or
    // reordered. Two routes already read _g.id to attribute money
    // (rebuy/addon p_processed_by), which would silently become undefined.
    // guardStaff always returns the staff row or ends the request.
    const _g = await guardStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' } });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id, status')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
      }
      
      // Venue scope: a valid session for one room must never reach
      // another room's tournament. See src/lib/commander/venueScope.js.
      if (denyCrossVenue(res, _g, tournament)) return;

      const { entry_id } = req.body;
      // Both columns are INTEGER, and this route only tested for `undefined`.
      // Two consequences, both real:
      //   to_seat: 0 or 99 was written verbatim, putting the player in a chair
      //   outside every `for (s = 1; s <= max_seats; s++)` scan - so they were
      //   never counted as occupying it while the index still reserved the
      //   pair, and the table map drew a seat that does not exist;
      //   a STRING "3" made the destination-occupied guard below compare
      //   "3" === 3 and pass, because that check uses ===  against an INTEGER
      //   column. Coercing here closes both.
      // Bounds match seat.js, which already validated this properly.
      const to_table = Number(req.body.to_table);
      const to_seat = Number(req.body.to_seat);
      if (!entry_id || req.body.to_table === undefined || req.body.to_seat === undefined
        || !Number.isInteger(to_table) || to_table < 1
        || !Number.isInteger(to_seat) || to_seat < 1 || to_seat > 12) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'entry_id, A Whole-Number to_table, And to_seat (1 To 12) Are Required' } });
      }

      // Get the entry
      const { data: entry, error: eErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entry_id)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (eErr || !entry) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entry Not Found' } });
      }
      // Only live players hold seats. 'eliminated' was the only status blocked,
      // so a cancelled, cashed, bagged or winner entry could still be parked on
      // a live seat that the floor then could not fill.
      if (!['registered', 'seated', 'active', 'alternate'].includes(entry.status)) {
        return res.status(400).json({ success: false, error: { code: 'PLAYER_NOT_ACTIVE', message: `Cannot Move A Player With Status ${entry.status}` } });
      }

      // Check destination seat is not occupied.
      // .maybeSingle() throws when two rows share the seat (exactly the state
      // this guard exists to catch) and the discarded error let the move through.
      const { data: existingRows, error: occErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_name')
        .eq('tournament_id', tournamentId)
        .eq('table_number', to_table)
        .eq('seat_number', to_seat)
        // SEAT OCCUPANCY: only a player physically in the chair blocks it.
        // 'bagged' excluded on purpose (they hold no seat).
        // 2026-08-20: 'registered' MUST be included. A player seated before the
        // clock starts keeps status 'registered' until play begins, and
        // production currently has 52 such entries holding real seats. Omitting
        // them let a move drop a player straight on top of one of them.
        .in('status', LIVE_SEAT_STATUSES)
        .neq('id', entry_id)
        .limit(1);

      if (occErr) {
        console.error('[tournaments/move-player] seat occupancy read failed', {
          tournamentId, code: occErr.code, message: occErr.message, details: occErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Verify Destination Seat' } });
      }

      const existing = (existingRows || [])[0];
      if (existing) {
        return res.status(409).json({
          success: false,
          error: { code: 'SEAT_OCCUPIED', message: `Seat ${to_seat} At Table ${to_table} Is Occupied By ${existing.player_name}` }
        });
      }

      const fromTable = entry.table_number;
      const fromSeat = entry.seat_number;

      // This route accepts an 'alternate' (line 79) but used to write NO status
      // at all, so the player ended up in a chair still marked 'alternate'.
      // uq_commander_entries_live_seat only covers
      // ('registered','seated','active'), so that row is invisible to the one
      // constraint that stops two people sharing a seat - and to every
      // occupancy probe. Moving someone into a chair means they are sitting in
      // it; say so. Matches seat.js and promote.js.
      const movedStatus = ['registered', 'bagged', 'alternate'].includes(entry.status)
        ? 'seated'
        : entry.status;

      // Execute move
      const { data: updated, error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          table_number: to_table,
          seat_number: to_seat,
          status: movedStatus,
          metadata: {
            ...entry.metadata,
            last_moved_at: new Date().toISOString(),
            last_moved_from: { table: fromTable, seat: fromSeat }
          }
        })
        .eq('id', entry_id)
        .select()
        .maybeSingle();

      if (uErr) {
        // The occupancy probe above is a read. Between it and this write another
        // device can fill the chair, and uq_commander_entries_live_seat now
        // rejects the loser with 23505 rather than double-booking the seat.
        if (seatConflictResponse(res, uErr, {
          tableNumber: to_table, seatNumber: to_seat, action: 'Player Move'
        })) return;
        console.error('[tournaments/move-player] move write failed', {
          tournamentId, entry_id, code: uErr.code, message: uErr.message, details: uErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Move Player' } });
      }

      return res.status(200).json({
        success: true,
        data: {
          entry: updated,
          move: {
            player_name: entry.player_name,
            from_table: fromTable,
            from_seat: fromSeat,
            to_table: to_table,
            to_seat: to_seat
          }
        }
      });
    } catch (err) {
      console.warn('Move player error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
