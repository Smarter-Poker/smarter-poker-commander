/**
 * Seat Waitlist Player
 * POST /api/commander/waitlist/seat
 * Moves player from waitlist to a table seat, marks waitlist entry as seated
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
import { logAction, AuditActions } from '../../../src/lib/commander/audit';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

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
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
      const staff = _g; // from guardWriteStaff
      const { waitlist_id, table_number, seat_number } = req.body;
      if (!waitlist_id || !table_number || !seat_number) {
        return res.status(400).json({ success: false, error: 'waitlist_id, table_number, and seat_number required' });
      }

      // Get waitlist entry
      const { data: entry } = await getSupabase()
        .from('commander_waitlist')
        .select('*')
        .eq('id', waitlist_id)
        .maybeSingle();

      if (!entry) return res.status(404).json({ success: false, error: 'Waitlist entry not found' });

      // 2026-07-25 audit fix: acting staff must belong to the entry's venue
      if (String(staff.venue_id) !== String(entry.venue_id)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' } });
      }

      // 2026-07-25 audit fix: resolve the target game server-side when the
      // entry has no game_id, and verify the seat is free - BEFORE deleting
      // the waitlist entry (previously the entry was deleted even when no
      // game could be resolved, silently dropping the player).
      let gameId = entry.game_id || null;
      if (!gameId) {
        const { data: candidateGames } = await getSupabase()
          .from('commander_games')
          .select('id')
          .eq('venue_id', entry.venue_id)
          .ilike('game_type', entry.game_type || '')
          .eq('stakes', entry.stakes)
          .in('status', ['waiting', 'running'])
          .order('created_at', { ascending: true })
          .limit(1);
        gameId = candidateGames?.[0]?.id || null;
      }

      if (!gameId) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_MATCHING_GAME', message: 'No open game matches this waitlist entry (game type + stakes). Start the game first, then seat the player.' }
        });
      }

      // Seat-occupancy check: 409 if the requested seat is already taken
      const { data: existingSeat } = await getSupabase()
        .from('commander_seats')
        .select('id, status, player_name')
        .eq('game_id', gameId)
        .eq('seat_number', seat_number)
        .maybeSingle();

      if (existingSeat && existingSeat.status === 'occupied') {
        return res.status(409).json({
          success: false,
          error: { code: 'SEAT_TAKEN', message: `Seat ${seat_number} is already occupied` }
        });
      }

      // Log to history (non-blocking)
      try {
        await getSupabase().from('commander_waitlist_history').insert({
          venue_id: entry.venue_id,
          player_id: entry.player_id,
          game_type: entry.game_type,
          stakes: entry.stakes,
          wait_time_minutes: Math.round((Date.now() - new Date(entry.created_at).getTime()) / (1000 * 60)),
          was_seated: true,
          signup_method: entry.signup_method
        });
      } catch { /* history is non-critical */ }

      // Delete the waitlist entry (player is now seated)
      const { error: wlError } = await getSupabase()
        .from('commander_waitlist')
        .delete()
        .eq('id', waitlist_id);

      if (wlError) return res.status(500).json({ success: false, error: wlError.message });

      // Update actual seat in commander_seats
      // 2026-07-25 audit fix: gameId is always resolved by this point (entry.game_id or server-side lookup)
      try {
        await getSupabase()
          .from('commander_seats')
          .upsert({
            game_id: gameId,
            seat_number,
            status: 'occupied',
            player_name: entry.player_name,
            player_id: entry.player_id || null,
            seated_at: new Date().toISOString()
          }, { onConflict: 'game_id,seat_number' });
      } catch { /* seat update is non-critical */ }

      // Audit log
      await logAction(AuditActions.WAITLIST_SEAT, {
        venueId: staff.venue_id,
        staffId: staff.id,
        targetId: waitlist_id,
        targetType: 'commander_waitlist',
        targetName: entry.player_name || 'Player',
        metadata: { table_number, seat_number },
        req
      });

      return res.status(200).json({
        success: true,
        data: {
          waitlist_id,
          player_name: entry.player_name,
          table_number,
          seat_number,
          seated_at: new Date().toISOString()
        }
      });
    } catch (err) {
      console.warn('Waitlist seat error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
