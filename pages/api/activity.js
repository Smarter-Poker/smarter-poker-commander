/**
 * Activity Log API
 * GET  /api/commander/activity - List recent activity events
 * POST /api/commander/activity - Log a new activity event
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

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

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    try {
      if (req.method === 'GET') {
        // Activity log: venue-specific, near-realtime — 15s CDN cache is safe
        res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
        const { venue_id, event_type, limit: lim } = req.query;
        let query = getSupabase().from('commander_activity_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(Math.min(parseInt(lim) || 50, 500));

        if (venue_id) query = query.eq('venue_id', venue_id);
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

        const { data, error } = await getSupabase().from('commander_activity_log').insert({
          venue_id: venue_id || '00000000-0000-0000-0000-000000000000',
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
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
