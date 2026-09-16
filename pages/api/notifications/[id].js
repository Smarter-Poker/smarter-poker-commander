/**
 * Notification Detail API
 * PATCH - Mark notification as read
 * DELETE - Delete a notification
 */
// 2026-07-25 audit fix: dual auth - the old code required BOTH a Bearer JWT
// and a staff session, blocking players from marking their own notifications
// and PIN staff from mutating venue ones. Now: a Bearer user may mutate rows
// whose player_id is their own; a verified staff session may mutate rows
// belonging to their venue.
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
    const { id } = req.query;

    if (!['PATCH', 'DELETE'].includes(req.method)) {
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

    // Load the notification and check ownership
    const { data: notification, error: loadError } = await getSupabase()
      .from('commander_notifications')
      .select('id, player_id, venue_id')
      .eq('id', id)
      .maybeSingle();

    if (loadError) {
      console.warn('Notification load error:', loadError);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }

    const ownedByUser = user && notification.player_id && String(notification.player_id) === String(user.id);
    const ownedByVenue = staff && String(notification.venue_id) === String(staff.venue_id);
    if (!ownedByUser && !ownedByVenue) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    if (req.method === 'PATCH') {
      // Mark notification as read
      const { read_at } = req.body || {};

      const { data, error } = await getSupabase()
        .from('commander_notifications')
        .update({
          read_at: read_at || new Date().toISOString()
        })
        .eq('id', id)
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
        .eq('id', id);

      if (error) {
        console.warn('Delete error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[pages/api/commander/notifications/[id].js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
