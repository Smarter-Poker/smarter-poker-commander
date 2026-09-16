/**
 * Mark Notification Read API
 * PATCH /api/commander/notifications/:id/read
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';

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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    if (req.method !== 'PATCH') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only PATCH allowed' }
      });
    }

    const { id } = req.query;

    try {
      // 2026-08-20 audit fix: the update ran on a bare id with no venue check,
      // so any staff member could mark another venue's notifications read.
      const { data: target } = await getSupabase()
        .from('commander_notifications')
        .select('id, venue_id')
        .eq('id', id)
        .maybeSingle();

      if (!target) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Notification Not Found' }
        });
      }

      if (_staff.venue_id !== undefined && _staff.venue_id !== null
          && String(target.venue_id) !== String(_staff.venue_id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' }
        });
      }

      const { data: notification, error } = await getSupabase()
        .from('commander_notifications')
        .update({
          read_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;

      return res.status(200).json({
        success: true,
        data: { notification }
      });
    } catch (error) {
      console.warn('Mark read error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to mark as read' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
