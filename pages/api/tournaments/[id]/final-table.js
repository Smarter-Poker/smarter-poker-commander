/**
 * Final Table API
 * POST /api/commander/tournaments/[id]/final-table
 * Sets up the final table by moving all remaining players to a single table
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
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament for clock_state
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });

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

      for (let i = 0; i < activeEntries.length; i++) {
        const entry = activeEntries[i];
        const newSeat = i + 1;

        if (entry.table_number === targetTable && entry.seat_number === newSeat) continue;

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
        if (uErr) {
          moveErrors.push({ entry_id: entry.id, player_name: entry.player_name, error: uErr.message });
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
          moves,
          errors: moveErrors.length > 0 ? moveErrors : undefined,
          message: moveErrors.length === 0
            ? `Final Table Set At Table ${targetTable} With ${activeEntries.length} Players`
            : `Final Table Set At Table ${targetTable}, But ${moveErrors.length} Seat Assignment(s) Failed`
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
