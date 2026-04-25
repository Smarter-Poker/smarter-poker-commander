/**
 * Mark All Notifications Read API
 * POST - Mark all user's notifications as read
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    if (!applyRateLimit(req, res, LIMITS.write)) return;
  }

    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await guardWriteStaff(req, res);
      if (!_staff) return;
    }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Verify auth
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
  const user = authData?.user;

  if (authError || !user) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }

  // Mark all unread notifications as read
  const { data, error } = await getSupabase()
    .from('commander_notifications')
    .update({
      read_at: new Date().toISOString()
    })
    .eq('player_id', user.id)
    .is('read_at', null)
    .select();

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
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[pages/api/commander/notifications/mark-all-read.js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
