/**
 * Balance Execute API
 * POST /api/commander/tournaments/[id]/balance-execute
 * Batch-executes multiple player moves (from balance-suggest or manual)
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
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

      const { moves } = req.body;
      if (!Array.isArray(moves) || moves.length === 0) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'moves Array Required' } });
      }

      // This route never loaded the tournament at all - it wrote entries
      // scoped only by .eq('tournament_id', tournamentId), taken from the URL.
      // A valid staff session for any room could therefore reseat any other
      // room's live event. The row is loaded here purely to establish whose
      // tournament this is before a single seat is written.
      const { data: tournament } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id')
        .eq('id', tournamentId)
        .maybeSingle();

      if (!tournament) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
      }
      if (denyCrossVenue(res, _g, tournament)) return;

      const results = [];
      const errors = [];
      const timestamp = new Date().toISOString();

      // --- Reject duplicate destinations INSIDE the batch itself ---
      // Two moves naming the same (table, seat) both used to succeed, silently
      // double-seating a table. break-table.js already guarded this; this route
      // did not.
      const seatKeys = new Set();
      for (const m of moves) {
        if (m.to_table === undefined || m.to_seat === undefined) continue;
        const key = `${m.to_table}-${m.to_seat}`;
        if (seatKeys.has(key)) {
          return res.status(400).json({
            success: false,
            error: { code: 'DUPLICATE_SEAT', message: `Duplicate Assignment: Table ${m.to_table} Seat ${m.to_seat}` }
          });
        }
        seatKeys.add(key);
      }

      // --- RACE CONDITION GUARD: Verify all destination seats are still empty ---
      // Scoped to the destination tables only, so the read is bounded by table
      // count rather than field size (an unbounded/truncated read in a 1000+
      // entry tournament silently skipped seats and missed real conflicts).
      const destTables = [...new Set(moves.map(m => m.to_table).filter(t => t !== undefined && t !== null))];
      const { data: conflictingSeats, error: cErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, table_number, seat_number, player_name')
        .eq('tournament_id', tournamentId)
        // SEAT OCCUPANCY: LIVE_SEAT_STATUSES mirrors the uq_commander_entries_live_seat
        // index exactly. 'registered' holds a chair - omitting it made this probe
        // report a taken seat as free, and the index then raised a 23505 the floor
        // saw as a phantom "another device filled it first". 'bagged' holds none.
                .in('status', LIVE_SEAT_STATUSES)
        .in('table_number', destTables.length > 0 ? destTables : [-1]);

      // A discarded error here made the guard pass on an empty result and the
      // batch went on to overwrite live seats.
      if (cErr) {
        console.error('[tournaments/balance-execute] seat conflict read failed', {
          tournamentId, code: cErr.code, message: cErr.message, details: cErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Verify Destination Seats' } });
      }

      const occupiedList = (conflictingSeats || []).filter(e =>
        !moves.some(m => m.entry_id === e.id) &&
        moves.some(m => m.to_table === e.table_number && m.to_seat === e.seat_number)
      );

      if (occupiedList.length > 0) {
        const e = occupiedList[0];
        return res.status(409).json({
          success: false,
          error: { code: 'SEAT_OCCUPIED', message: `Balance Aborted: Seat ${e.seat_number} At Table ${e.table_number} Is Now Occupied By ${e.player_name}` }
        });
      }

      for (const move of moves) {
        if (!move.entry_id || move.to_table === undefined || move.to_seat === undefined) {
          errors.push({ entry_id: move.entry_id, error: 'Missing to_table Or to_seat' });
          continue;
        }

        const { data: entry, error: readErr } = await getSupabase()
          .from('commander_tournament_entries')
          .select('table_number, seat_number, player_name, status, metadata')
          .eq('id', move.entry_id)
          .eq('tournament_id', tournamentId)
          .maybeSingle();

        if (readErr) {
          errors.push({ entry_id: move.entry_id, error: readErr.message });
          continue;
        }
        if (!entry) {
          errors.push({ entry_id: move.entry_id, error: 'Entry Not Found' });
          continue;
        }
        // Only live players can be balanced. Moving an eliminated or cancelled
        // entry parks a dead player on a live seat that the floor then cannot fill.
        // Only a player currently in a chair can be moved out of it. A
        // 'bagged' player has no seat, so a balance move is meaningless.
        if (!['active', 'seated'].includes(entry.status)) {
          errors.push({ entry_id: move.entry_id, error: `Player Is Not Active (Status: ${entry.status})` });
          continue;
        }

        const { error: uErr } = await getSupabase()
          .from('commander_tournament_entries')
          .update({
            table_number: move.to_table,
            seat_number: move.to_seat,
            metadata: {
              ...(entry.metadata || {}),
              last_moved_at: timestamp,
              last_moved_from: { table: entry.table_number, seat: entry.seat_number },
              move_reason: move.reason || 'balance'
            }
          })
          .eq('id', move.entry_id)
          // Scope to this tournament so a stray entry_id cannot be moved.
          .eq('tournament_id', tournamentId);

        if (uErr) {
          // A single collision must not abort the batch: the other moves are
          // legitimate and the floor still wants them applied.
          // uq_commander_entries_live_seat rejects a destination chair that was
          // filled after the pre-flight conflict read above.
          errors.push(rowConflict(uErr, {
            entryId: move.entry_id,
            playerName: entry.player_name,
            tableNumber: move.to_table,
            seatNumber: move.to_seat,
            action: 'Table Balance'
          }));
        } else {
          results.push({
            entry_id: move.entry_id,
            player_name: entry.player_name,
            from_table: entry.table_number,
            from_seat: entry.seat_number,
            to_table: move.to_table,
            to_seat: move.to_seat
          });
        }
      }

      const collided = countCollisions(errors);

      return res.status(200).json({
        success: errors.length === 0,
        data: {
          executed: results.length,
          failed: errors.length,
          seat_collisions: collided,
          moves: results,
          errors: errors.length > 0 ? errors : undefined,
          message: errors.length === 0
            ? `${results.length} Move${results.length === 1 ? '' : 's'} Applied.`
            : `${results.length} Move${results.length === 1 ? '' : 's'} Applied, ${errors.length} Failed${collided > 0 ? `, ${collided} Because The Destination Seat Was Already Taken` : ''}. Re-Run Balance After Refreshing The Table Map.`
        }
      });
    } catch (err) {
      console.warn('Balance execute error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
