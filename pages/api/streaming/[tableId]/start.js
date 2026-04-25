/**
 * Start Stream API
 * POST /api/commander/streaming/:tableId/start
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF — requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { tableId } = req.query;
    const { venue_id, platforms = ['youtube'], delay_minutes = 15, overlay_config } = req.body;

    if (!venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'venue_id required' }
      });
    }

    try {
      // Check if stream already exists for this table
      const { data: existing } = await getSupabase()
        .from('commander_streams')
        .select('id')
        .eq('table_id', tableId)
        .eq('status', 'live')
        .maybeSingle();

      if (existing) {
        return res.status(400).json({
          success: false,
          error: { code: 'ALREADY_STREAMING', message: 'Table is already streaming' }
        });
      }

      // Create or update stream record
      const { data: stream, error } = await getSupabase()
        .from('commander_streams')
        .upsert({
          venue_id,
          table_id: tableId,
          status: 'live',
          platforms,
          delay_minutes,
          overlay_config: overlay_config || {},
          started_at: new Date().toISOString(),
          viewer_count: 0
        }, {
          onConflict: 'table_id'
        })
        .select()
        .maybeSingle();

      if (error) throw error;

      return res.status(200).json({
        success: true,
        data: { stream }
      });
    } catch (error) {
      console.warn('Start stream error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to start stream' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
