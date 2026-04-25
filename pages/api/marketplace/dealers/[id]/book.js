/**
 * Book Dealer API
 * POST /api/commander/marketplace/dealers/[id]/book - Book a freelance dealer
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/sentryWrap';

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
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { id } = req.query;

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authorization required' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
        });
      }

      const { home_game_id, event_date, start_time, end_time, message } = req.body;

      if (!home_game_id || !event_date) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'home_game_id and event_date required' }
        });
      }

      // Get dealer listing
      const { data: dealer, error: dealerError } = await getSupabase()
        .from('commander_dealer_marketplace')
        .select('*, profiles:dealer_id (id, display_name, email)')
        .eq('id', id)
        .eq('status', 'active')
        .maybeSingle();

      if (dealerError || !dealer) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Dealer not found or unavailable' }
        });
      }

      // Verify home game exists and user is host
      const { data: game, error: gameError } = await getSupabase()
        .from('commander_home_games')
        .select('id, host_id, name, scheduled_date')
        .eq('id', home_game_id)
        .maybeSingle();

      if (gameError || !game) {
        return res.status(404).json({
          success: false,
          error: { code: 'GAME_NOT_FOUND', message: 'Home game not found' }
        });
      }

      if (game.host_id !== user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only the host can book dealers' }
        });
      }

      // Create booking notification to dealer
      const { data: notification, error: notifError } = await getSupabase()
        .from('commander_notifications')
        .insert({
          player_id: dealer.dealer_id,
          notification_type: 'dealer_booking_request',
          channel: 'in_app',
          title: 'New Booking Request',
          message: `${user.email} wants to book you for "${game.name}" on ${event_date}`,
          metadata: {
            home_game_id,
            host_id: user.id,
            event_date,
            start_time,
            end_time,
            message,
            dealer_listing_id: id
          },
          status: 'sent'
        })
        .select()
        .maybeSingle();

      if (notifError) {
        console.warn('Notification error:', notifError);
      }

      return res.status(200).json({
        success: true,
        data: {
          message: 'Booking request sent to dealer',
          dealer_name: dealer.name,
          notification_id: notification?.id
        }
      });
    } catch (error) {
      console.warn('Book dealer error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to send booking request' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
