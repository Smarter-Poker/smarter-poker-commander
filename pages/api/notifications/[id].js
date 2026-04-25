/**
 * Notification Detail API
 * PATCH - Mark notification as read
 * DELETE - Delete a notification
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
  const { id } = req.query;

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


    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await guardWriteStaff(req, res);
      if (!_staff) return;
    }

  if (req.method === 'PATCH') {
    // Mark notification as read
    const { read_at } = req.body;

    const { data, error } = await getSupabase()
      .from('commander_notifications')
      .update({
        read_at: read_at || new Date().toISOString()
      })
      .eq('id', id)
      .eq('player_id', user.id)
      .select()
      .maybeSingle();

    if (error) {
      console.warn('Mark read error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

    return res.status(200).json({ success: true, data: { notification: data } });
  }

  if (req.method === 'DELETE') {
    // Delete notification
    const { error } = await getSupabase()
      .from('commander_notifications')
      .delete()
      .eq('id', id)
      .eq('player_id', user.id);

    if (error) {
      console.warn('Delete error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[pages/api/commander/notifications/[id].js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
