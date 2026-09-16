/**
 * Mark All Notifications Read API
 * POST - Mark all user's notifications as read
 */
// 2026-07-25 audit fix: dual auth - the old code required BOTH a staff-session
// guard and a Bearer JWT, blocking players (no staff session) and PIN staff
// (no JWT). Now: a Bearer user marks their own rows read; a verified staff
// session marks the venue's rows read.
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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    // 2026-07-25 audit fix: accept a Bearer user OR a verified staff session
    const user = await getUser(req, res);
    let staff = null;
    if (!user) {
      const sessionResult = await verifyStaffSession(req);
      if (sessionResult.staff) staff = sessionResult.staff;
    }

    if (!user && !staff) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Mark all unread notifications as read within the caller's scope
    let query = getSupabase()
      .from('commander_notifications')
      .update({
        read_at: new Date().toISOString()
      })
      .is('read_at', null);

    if (user) {
      query = query.eq('player_id', user.id);
    } else {
      query = query.eq('venue_id', staff.venue_id);
    }

    const { data, error } = await query.select();

    if (error) {
      console.warn('Mark all read error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

    return res.status(200).json({
      success: true,
      data: {
        updated_count: data?.length || 0
      }
    });
  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[pages/api/commander/notifications/mark-all-read.js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
