/**
 * Final Table API
 * POST /api/commander/tournaments/[id]/final-table
 * Sets up the final table by moving all remaining players to a single table
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { rowConflict, countCollisions } from '../../../../src/lib/commander/dbErrors';
import { denyCrossVenue } from '../../../../src/lib/commander/venueScope';

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

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' } });

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament for clock_state
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
      
      // Venue scope: a valid session for one room must never reach
      // another room's tournament. See src/lib/commander/venueScope.js.
      if (denyCrossVenue(res, _g, tournament)) return;

      const { final_table_number } = req.body;
      const targetTable = final_table_number || 1;

      // Everyone still in the tournament. FIELD list, not seat occupancy:
      // this route GIVES seats rather than reading them, and on a multi-day
      // event the final table is formed out of the bagged field. Excluding
      // 'bagged' left returning players with no final-table seat while the
      // response reported the final table as set.
      const { data: activeEntries, error: eErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('tournament_id', tournamentId)
        .in('status', ['active', 'seated', 'bagged'])
        .order('current_chips', { ascending: false });

      // A discarded read error used to look identical to an empty field and the
      // TD was told there were "No Active Players" at the final table.
      if (eErr) {
        console.error('[tournaments/final-table] entries read failed', {
          tournamentId, code: eErr.code, message: eErr.message, details: eErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Read Tournament Entries' } });
      }

      if (!activeEntries || activeEntries.length === 0) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No Active Players' } });
      }
      if (activeEntries.length > 10) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Too Many Players (${activeEntries.length}) For Final Table. Max 10.` } });
      }

      // Assign seats 1-N, sorted by chip count (chip leader gets seat 1)
      const moves = [];
      const moveErrors = [];
      const timestamp = new Date().toISOString();

      // Which entries actually change chair.
      const plan = activeEntries
        .map((entry, i) => ({ entry, newSeat: i + 1 }))
        .filter(({ entry, newSeat }) => !(entry.table_number === targetTable && entry.seat_number === newSeat));

      // RELEASE FIRST. Seats are written one row at a time, and the final table
      // re-orders players who are ALREADY on the target table (chip leader takes
      // seat 1, and seat 1 is usually occupied by somebody who is about to move
      // to another seat). uq_commander_entries_live_seat now rejects that
      // transient overlap with 23505, so every player being re-seated on the
      // target table gives up their chair before anyone takes a new one.
      // A NULL seat is outside the partial index, so parking here is safe.
      const toRelease = plan
        .filter(({ entry }) => entry.table_number === targetTable)
        .map(({ entry }) => entry.id);

      if (toRelease.length > 0) {
        const { error: releaseErr } = await getSupabase()
          .from('commander_tournament_entries')
          .update({ table_number: null, seat_number: null })
          .eq('tournament_id', tournamentId)
          .in('id', toRelease);

        // Every one of these players is re-seated immediately below, so a failed
        // release only means the assignment that follows may collide. Log it
        // rather than aborting a final table that is half formed.
        if (releaseErr) {
          console.error('[tournaments/final-table] pre-release of target table seats failed', {
            tournamentId, targetTable,
            code: releaseErr.code, message: releaseErr.message, details: releaseErr.details,
          });
        }
      }

      for (const { entry, newSeat } of plan) {
        const { error: uErr } = await getSupabase()
          .from('commander_tournament_entries')
          .update({
            table_number: targetTable,
            seat_number: newSeat,
            // A bagged player who is given a final-table seat is sitting in
            // it. Leaving them 'bagged' would hide them from every occupancy
            // check while they physically hold the chair.
            ...(entry.status === 'bagged' ? { status: 'seated' } : {}),
            metadata: {
              ...(entry.metadata || {}),
              last_moved_at: timestamp,
              last_moved_from: { table: entry.table_number, seat: entry.seat_number },
              move_reason: 'final_table'
            }
          })
          .eq('id', entry.id)
          .eq('tournament_id', tournamentId);

        // A failed seat write used to be dropped on the floor: the player kept
        // their old table/seat, the response reported the final table as set,
        // and nobody was told.
        // A single collision must not abort the final table: the rest of the
        // players still take their chairs and the failures are listed so the
        // floor can place those players by hand.
        if (uErr) {
          moveErrors.push(rowConflict(uErr, {
            entryId: entry.id,
            playerName: entry.player_name,
            tableNumber: targetTable,
            seatNumber: newSeat,
            action: 'Final Table Seating'
          }));
        } else {
          moves.push({
            entry_id: entry.id,
            player_name: entry.player_name,
            from_table: entry.table_number,
            from_seat: entry.seat_number,
            to_table: targetTable,
            to_seat: newSeat,
            chips: entry.current_chips
          });
        }
      }

      // Update tournament status + clock state atomically via the
      // commander_clock_write RPC (jsonb_set on settings.clock_state) so a
      // concurrent settings write from another tablet is never clobbered.
      const clockState = (tournament.settings || {}).clock_state || {};
      const updatedClockState = {
        ...clockState,
        hand_for_hand: false,
        final_table: true,
        final_table_started_at: timestamp
      };

      // DO NOT declare a final table that was not actually formed.
      //
      // This wrote status 'final_table' unconditionally and returned HTTP 200
      // even when every single move had failed - so the event was marked as
      // being on its final table while the players were still spread across
      // the room, or worse, sitting with NULL table/seat after the pre-release
      // above succeeded and their re-seat did not. Those players are live with
      // no chair and appear only inside data.errors.
      //
      // If nothing could be seated, the tournament state is left alone and the
      // caller gets a 409 describing what collided, so the floor can fix the
      // table and run it again.
      if (moves.length === 0 && moveErrors.length > 0) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'FINAL_TABLE_NOT_FORMED',
            message: 'No Player Could Be Seated At The Final Table. Tournament Status Unchanged.',
            players_failed: moveErrors.length,
            seat_collisions: countCollisions(moveErrors),
            errors: moveErrors
          }
        });
      }

      const { error: uErr } = await getSupabase().rpc('commander_clock_write', {
        p_tournament_id: tournamentId,
        p_clock_state: updatedClockState,
        p_updates: { status: 'final_table' }
      });

      if (uErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Set Final Table Status' } });

      return res.status(200).json({
        success: moveErrors.length === 0,
        data: {
          final_table_number: targetTable,
          players: activeEntries.length,
          players_seated: moves.length,
          players_failed: moveErrors.length,
          seat_collisions: countCollisions(moveErrors),
          // A player whose pre-release succeeded and whose re-seat failed is
          // now live with NO table and NO seat. That is a floor emergency, not
          // a line item, so it is named explicitly rather than left for
          // somebody to infer from the errors array.
          players_left_unseated: moveErrors.length > 0
            ? moveErrors.map(e => e.player_name || e.entry_id).filter(Boolean)
            : undefined,
          moves,
          errors: moveErrors.length > 0 ? moveErrors : undefined,
          message: moveErrors.length === 0
            ? `Final Table Set At Table ${targetTable} With ${activeEntries.length} Players`
            : `Final Table Set At Table ${targetTable}, ${moves.length} Seated, ${moveErrors.length} Seat Assignment(s) Failed. Seat Those Players By Hand.`
        }
      });
    } catch (err) {
      console.warn('Final table error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
