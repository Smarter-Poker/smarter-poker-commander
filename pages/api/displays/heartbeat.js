/**
 * Tablet Heartbeat API
 * POST /api/commander/displays/heartbeat
 *
 * Tablets ping this every 30s so the admin knows which are online.
 * 2026-07-25 audit fix: no longer auto-registers devices — an unauthenticated
 * endpoint must not create display rows for arbitrary venues. Registration
 * happens via the authenticated displays API; this endpoint only updates
 * existing rows.
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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { table_number, venue_id } = req.body;

      if (!table_number || !venue_id) {
          return res.status(400).json({ success: false, error: 'table_number and venue_id required' });
      }

      // 2026-07-25 audit fix: table_number must be a small positive integer
      const tableNum = Number(table_number);
      if (!Number.isInteger(tableNum) || tableNum < 1 || tableNum > 999) {
          return res.status(400).json({ success: false, error: 'table_number must be a positive integer' });
      }

      try {
          // Deterministic device_id from venue + table (matches registration)
          const deviceId = `tablet-${venue_id}-table-${tableNum}`;
          const now = new Date().toISOString();

          // 2026-07-25 audit fix: UPDATE only — never create rows from an
          // unauthenticated heartbeat. Unregistered devices get a 404.
          const { data: updated, error } = await getSupabase()
              .from('commander_table_displays')
              .update({
                  is_online: true,
                  last_heartbeat: now,
              })
              .eq('device_id', deviceId)
              .eq('venue_id', venue_id)
              .select('id')
              .maybeSingle();

          if (error) {
              // 2026-07-25 audit fix: surface update errors instead of swallowing
              console.warn('Heartbeat update error:', error.message);
              return res.status(500).json({ success: false, error: 'Failed to record heartbeat' });
          }

          if (!updated) {
              return res.status(404).json({ success: false, error: 'Device not registered' });
          }

          return res.status(200).json({ success: true, timestamp: now });

      } catch (err) {
          console.warn('Heartbeat error:', err);
          return res.status(500).json({ success: false, error: err.message });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
