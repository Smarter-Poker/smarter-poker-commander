/**
 * Display Status API
 * GET /api/commander/displays/status?venue_id=VENUE_ID
 *
 * Returns the online status of all registered tablet displays for a venue.
 * Used by the admin table-tablets page to show green/gray online indicators.
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
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { venue_id } = req.query;

      if (!venue_id) {
          return res.status(400).json({ success: false, error: 'venue_id required' });
      }

      try {
          const { data, error } = await getSupabase()
              .from('commander_table_displays')
              .select('device_id, device_name, device_type, is_online, last_heartbeat')
              .eq('venue_id', venue_id)
              .order('device_name', { ascending: true })
                  .limit(100);

          if (error) {
              // Table might not exist yet - return empty
              return res.status(200).json({ success: true, data: [] });
          }

          // Mark devices as offline if heartbeat is stale (>2 min)
          const TWO_MINUTES = 2 * 60 * 1000;
          const enriched = (data || []).map(d => ({
              ...d,
              is_online: d.is_online && d.last_heartbeat && (Date.now() - new Date(d.last_heartbeat).getTime()) < TWO_MINUTES,
          }));

          return res.status(200).json({ success: true, data: enriched });
      } catch (err) {
          console.warn('Display status error:', err);
          return res.status(500).json({ success: false, error: err.message });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
