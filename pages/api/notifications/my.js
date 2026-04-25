/**
 * Player Notifications API
 * GET /api/commander/notifications/my
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
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

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    // Get player from auth header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
      });
    }

    try {
      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Invalid token' }
        });
      }

      const { unread_only, limit = 50 } = req.query;

      let query = getSupabase()
        .from('commander_notifications')
        .select(`
          *,
          poker_venues (id, name)
        `)
        .eq('player_id', user.id)
        .order('created_at', { ascending: false })
        .limit(Math.min(parseInt(limit) || 50, 500));

      if (unread_only === 'true') {
        query = query.is('read_at', null);
      }

      const { data: notifications, error } = await query;

      if (error) throw error;

      // Count unread
      const { count: unreadCount } = await getSupabase()
        .from('commander_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', user.id)
        .is('read_at', null)

      return res.status(200).json({
        success: true,
        data: {
          notifications: notifications || [],
          unread_count: unreadCount || 0
        }
      });
    } catch (error) {
      console.warn('Get notifications error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch notifications' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
