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

      // --- RACE CONDITION GUARD: Verify all destination seats are still empty ---
      // (limit raised from 100: a truncated read here silently skipped seats
      // in large fields and the guard missed real conflicts)
      const { data: conflictingSeats } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, table_number, seat_number, player_name')
        .eq('tournament_id', tournamentId)
        .in('status', ['active', 'seated'])
            .limit(1000);

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

        const { data: entry } = await getSupabase()
          .from('commander_tournament_entries')
          .select('table_number, seat_number, player_name, metadata')
          .eq('id', move.entry_id)
          .eq('tournament_id', tournamentId)
          .maybeSingle();

        if (!entry) {
          errors.push({ entry_id: move.entry_id, error: 'Entry Not Found' });
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
          .eq('id', move.entry_id);

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
