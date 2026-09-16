/**
 * Player Notifications API
 * GET /api/commander/notifications/my
 */
// 2026-07-25 audit fix: dual auth - a Bearer user sees their own rows, a
// verified staff session (PIN terminal or owner) sees the venue's rows. The
// old JWT-only path locked out PIN-terminal staff.
import { createClient } from '../../../src/lib/supabaseServerClient';
import { getUser, verifyStaffSession } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

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

    // 2026-07-25 audit fix: accept a Bearer user OR a verified staff session
    const user = await getUser(req, res);
    let staff = null;
    if (!user) {
      const sessionResult = await verifyStaffSession(req);
      if (sessionResult.staff) staff = sessionResult.staff;
    }

    if (!user && !staff) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
      });
    }

    try {
      const { unread_only, limit = 50 } = req.query;

      let query = getSupabase()
        .from('commander_notifications')
        .select(`
          *,
          poker_venues (id, name)
        `)
        .order('created_at', { ascending: false })
        .limit(Math.min(parseInt(limit) || 50, 500));

      // 2026-07-25 audit fix: players see their own rows, staff see the venue's
      if (user) {
        query = query.eq('player_id', user.id);
      } else {
        query = query.eq('venue_id', staff.venue_id);
      }

      if (unread_only === 'true') {
        query = query.is('read_at', null);
      }

      const { data: notifications, error } = await query;

      if (error) throw error;

      // Count unread with the same scope
      let countQuery = getSupabase()
        .from('commander_notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (user) {
        countQuery = countQuery.eq('player_id', user.id);
      } else {
        countQuery = countQuery.eq('venue_id', staff.venue_id);
      }
      const { count: unreadCount } = await countQuery;

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
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
