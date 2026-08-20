/**
 * Balance Execute API
 * POST /api/commander/tournaments/[id]/balance-execute
 * Batch-executes multiple player moves (from balance-suggest or manual)
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
        // SEAT OCCUPANCY: balancing moves people between chairs, and a
        // 'bagged' player is not in one. Excluded on purpose.
        .in('status', ['active', 'seated'])
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
          errors.push({ entry_id: move.entry_id, error: uErr.message });
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

      return res.status(200).json({
        success: errors.length === 0,
        data: {
          executed: results.length,
          failed: errors.length,
          moves: results,
          errors: errors.length > 0 ? errors : undefined
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
