/**
 * Move Player API
 * POST /api/commander/tournaments/[id]/move-player
 * Moves a tournament player to a different table and seat
 * Used by TD Tablet for table balancing and manual moves
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) {
      return res.status(400).json({ success: false, error: 'Tournament ID required' });
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
        return res.status(404).json({ success: false, error: 'Tournament not found' });
      }

      const { entry_id, to_table, to_seat } = req.body;
      if (!entry_id || to_table === undefined || to_seat === undefined) {
        return res.status(400).json({ success: false, error: 'entry_id, to_table, and to_seat required' });
      }

      // Get the entry
      const { data: entry, error: eErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entry_id)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (eErr || !entry) {
        return res.status(404).json({ success: false, error: 'Entry not found' });
      }
      if (entry.status === 'eliminated') {
        return res.status(400).json({ success: false, error: 'Cannot move eliminated player' });
      }

      // Check destination seat is not occupied
      const { data: existing } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_name')
        .eq('tournament_id', tournamentId)
        .eq('table_number', to_table)
        .eq('seat_number', to_seat)
        .in('status', ['active', 'seated'])
        .maybeSingle();

      if (existing) {
        return res.status(409).json({
          success: false,
          error: `Seat ${to_seat} at Table ${to_table} is occupied by ${existing.player_name}`
        });
      }

      const fromTable = entry.table_number;
      const fromSeat = entry.seat_number;

      // Execute move
      const { data: updated, error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          table_number: to_table,
          seat_number: to_seat,
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
        return res.status(500).json({ success: false, error: 'Failed to move player' });
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
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
