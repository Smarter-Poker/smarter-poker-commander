/**
 * Activity Log API
 * GET  /api/commander/activity - List recent activity events
 * POST /api/commander/activity - Log a new activity event
 */
import { createClient } from '../../src/lib/supabaseServerClient';
// 2026-07-25 audit fix: guardStaff added - GET must not be public (venue activity leak)
import { guardStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';

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

    // 2026-07-25 audit fix: require staff auth on ALL methods (GET previously
    // public via guardWriteStaff, dumping any venue's activity feed).
    const _authResult = await guardStaff(req, res);
    if (!_authResult) return;

    try {
      if (req.method === 'GET') {
        // 2026-07-25 audit fix: response now varies by staff session (venue-scoped),
        // so shared CDN caching would leak one venue's feed to another - cache privately.
        res.setHeader('Cache-Control', 'private, max-age=15');
        const { venue_id, event_type, limit: lim } = req.query;
        // 2026-07-25 audit fix: force venue scope to the session staff's venue;
        // an explicitly different venue_id is a cross-venue read attempt.
        if (venue_id && String(venue_id) !== String(_authResult.venue_id)) {
          return res.status(403).json({ success: false, error: 'Not authorized for this venue' });
        }
        let query = getSupabase().from('commander_activity_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(Math.min(parseInt(lim) || 50, 500));

        query = query.eq('venue_id', _authResult.venue_id);
        if (event_type) query = query.eq('event_type', event_type);

        const { data, error } = await query;
        if (error) throw error;
        return res.status(200).json({ success: true, data });
      }

      if (req.method === 'POST') {
        const { venue_id, event_type, message, detail, actor_id, actor_name, member_id, table_number, metadata } = req.body;
        if (!event_type || !message) {
          return res.status(400).json({ success: false, error: 'event_type and message required' });
        }
        // 2026-07-25 audit fix: venue_id is an integer column - the old UUID-string
        // default could never match a venue. Reject when absent instead.
        if (!venue_id) {
          return res.status(400).json({ success: false, error: 'venue_id required' });
        }

        const { data, error } = await getSupabase().from('commander_activity_log').insert({
          venue_id,
          event_type,
          message,
          detail: detail || '',
          actor_id,
          actor_name,
          member_id,
          table_number,
          metadata: metadata || {}
        }).select().maybeSingle();

        if (error) throw error;
        if (!data) return res.status(500).json({ success: false, error: 'Failed to log activity' });
        return res.status(201).json({ success: true, data });
      }

      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Activity log error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
