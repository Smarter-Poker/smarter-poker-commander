/**
 * Display Heartbeat API
 * POST /api/commander/displays/:deviceId/heartbeat
 *
 * 2026-07-28 audit fix: brought in line with the already-hardened sibling
 * pages/api/displays/heartbeat.js. This endpoint is unauthenticated, so it now
 * scopes the row match by venue, bounds and validates its inputs, and returns
 * only { success, timestamp }. It previously handed the display's display_mode,
 * rotation_screens, rotation_interval and full `config` jsonb to ANY caller who
 * could guess or read a device_id. It has never created rows, and still does not.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
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
    const { venue_id } = req.body || {};

    // 2026-07-28 audit fix: bound and validate every input.
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 128) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'deviceId required' }
      });
    }

    const venueId = Number(venue_id);
    if (!Number.isInteger(venueId) || venueId < 1) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'venue_id required' }
      });
    }

    try {
      // Update heartbeat. UPDATE only - never creates rows - and scoped to the
      // caller's venue so a device_id cannot be used against another club's row.
      const now = new Date().toISOString();
      const { data: display, error } = await getSupabase()
        .from('commander_table_displays')
        .update({
          is_online: true,
          last_heartbeat: now
        })
        .eq('device_id', deviceId)
        .eq('venue_id', venueId)
        .select('id')
        .maybeSingle();

      if (error || !display) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Display not registered' }
        });
      }

      // Minimum the screen needs - no config, no rotation settings.
      return res.status(200).json({ success: true, timestamp: now });
    } catch (error) {
      console.warn('Heartbeat error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Heartbeat failed' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
