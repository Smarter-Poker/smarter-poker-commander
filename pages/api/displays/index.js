/**
 * Table Display Management API
 * GET /api/commander/displays - List displays for venue
 * POST /api/commander/displays - Register new display
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF — requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    if (req.method === 'GET') {
      return handleGet(req, res);
    } else if (req.method === 'POST') {
      return handlePost(req, res);
    }

    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
    });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleGet(req, res) {
  const { venue_id } = req.query;

  if (!venue_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_VENUE', message: 'venue_id required' }
    });
  }

  try {
    // Verify staff auth — even GET operations should be authenticated
    const staffSession = req.headers['x-staff-session'];
    if (!staffSession) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' }
      });
    }

    let sessionData;
    try {
      sessionData = JSON.parse(staffSession);
    } catch {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SESSION', message: 'Invalid session' }
      });
    }

    const { data: displays, error } = await getSupabase()
      .from('commander_table_displays')
      .select(`
        *,
        commander_tables (
          id,
          table_number,
          table_name
        )
      `)
      .eq('venue_id', venue_id)
      .order('created_at', { ascending: false })
          .limit(100);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: { displays }
    });
  } catch (error) {
    console.warn('Get displays error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch displays' }
    });
  }
}

async function handlePost(req, res) {
  const staffSession = req.headers['x-staff-session'];
  if (!staffSession) {
    return res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' }
    });
  }

  let sessionData;
  try {
    sessionData = JSON.parse(staffSession);
  } catch {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_SESSION', message: 'Invalid session' }
    });
  }

  const {
    venue_id,
    table_id,
    device_id,
    device_name,
    device_type = 'tablet',
    display_mode = 'rotation',
    rotation_screens = ['waitlist', 'promotions', 'high_hand'],
    rotation_interval = 30
  } = req.body;

  if (!venue_id || !device_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'venue_id and device_id required' }
    });
  }

  try {
    // Check if device already registered
    const { data: existing } = await getSupabase()
      .from('commander_table_displays')
      .select('id')
      .eq('device_id', device_id)
      .maybeSingle();

    if (existing) {
      // Update existing
      const { data: display, error } = await getSupabase()
        .from('commander_table_displays')
        .update({
          venue_id,
          table_id,
          device_name,
          device_type,
          display_mode,
          rotation_screens,
          rotation_interval,
          is_online: true,
          last_heartbeat: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .maybeSingle();

      if (error) throw error;

      if (!display) return res.status(500).json({ success: false, error: 'Failed to update display' });

      return res.status(200).json({
        success: true,
        data: { display, updated: true }
      });
    }

    // Create new
    const { data: display, error } = await getSupabase()
      .from('commander_table_displays')
      .insert({
        venue_id,
        table_id,
        device_id,
        device_name: device_name || `Display ${device_id.slice(-4)}`,
        device_type,
        display_mode,
        rotation_screens,
        rotation_interval,
        is_online: true,
        last_heartbeat: new Date().toISOString()
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!display) return res.status(500).json({ success: false, error: 'Failed to create display' });

    return res.status(201).json({
      success: true,
      data: { display, created: true }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Register display error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to register display' }
    });
  }
}
