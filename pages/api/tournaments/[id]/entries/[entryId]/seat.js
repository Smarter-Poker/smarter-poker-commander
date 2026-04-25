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

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'PUT') {
      res.setHeader('Allow', ['PUT']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id: tournamentId, entryId } = req.query;
    if (!tournamentId || !entryId) {
      return res.status(400).json({ success: false, error: 'Tournament ID and Entry ID required' });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      const { data: tournament } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id')
        .eq('id', tournamentId)
        .maybeSingle();
      if (!tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });


      const { table_number, seat_number } = req.body;
      if (table_number === undefined || seat_number === undefined) {
        return res.status(400).json({ success: false, error: 'table_number and seat_number required' });
      }

      const { data: entry } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });

      // Check seat not occupied
      const { data: existing } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_name')
        .eq('tournament_id', tournamentId)
        .eq('table_number', table_number)
        .eq('seat_number', seat_number)
        .in('status', ['active', 'seated'])
        .neq('id', entryId)
        .maybeSingle();

      if (existing) {
        return res.status(409).json({
          success: false,
          error: `Seat ${seat_number} at Table ${table_number} occupied by ${existing.player_name}`
        });
      }

      const fromTable = entry.table_number;
      const fromSeat = entry.seat_number;

      // If the player is currently 'registered' but is given a seat, advance them to 'seated'
      const newStatus = entry.status === 'registered' ? 'seated' : entry.status;

      const { error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          table_number,
          seat_number,
          status: newStatus,
          metadata: {
            ...(entry.metadata || {}),
            last_moved_at: new Date().toISOString(),
            last_moved_from: { table: fromTable, seat: fromSeat },
            move_reason: 'seat_change'
          }
        })
        .eq('id', entryId);

      if (uErr) return res.status(500).json({ success: false, error: 'Failed to change seat' });

      return res.status(200).json({
        success: true,
        data: {
          entry_id: entryId,
          player_name: entry.player_name,
          from_table: fromTable,
          from_seat: fromSeat,
          to_table: table_number,
          to_seat: seat_number
        }
      });
    } catch (err) {
      console.warn('Seat change error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
