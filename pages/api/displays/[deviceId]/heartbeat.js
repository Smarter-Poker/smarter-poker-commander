/**
 * Display Heartbeat API
 * POST /api/commander/displays/:deviceId/heartbeat
 * Updates display online status and returns any config changes
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

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
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { deviceId } = req.query;

    try {
      // Update heartbeat
      const { data: display, error } = await getSupabase()
        .from('commander_table_displays')
        .update({
          is_online: true,
          last_heartbeat: new Date().toISOString()
        })
        .eq('device_id', deviceId)
        .select('id, display_mode, rotation_screens, rotation_interval, config, updated_at')
        .maybeSingle();

      if (error || !display) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Display not registered' }
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          display_id: display.id,
          config: {
            display_mode: display.display_mode,
            rotation_screens: display.rotation_screens,
            rotation_interval: display.rotation_interval,
            custom: display.config
          },
          last_config_update: display.updated_at
        }
      });
    } catch (error) {
      console.warn('Heartbeat error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Heartbeat failed' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
