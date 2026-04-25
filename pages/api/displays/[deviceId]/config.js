/**
 * Display Config API
 * GET /api/commander/displays/:deviceId/config - Get display config
 * PATCH /api/commander/displays/:deviceId/config - Update display config
 * DELETE /api/commander/displays/:deviceId/config - Remove display
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

    const { deviceId } = req.query;

    if (req.method === 'GET') {
      return handleGet(req, res, deviceId);
    } else if (req.method === 'PATCH') {
      return handlePatch(req, res, deviceId);
    } else if (req.method === 'DELETE') {
      return handleDelete(req, res, deviceId);
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

async function handleGet(req, res, deviceId) {
  try {
    const { data: display, error } = await getSupabase()
      .from('commander_table_displays')
      .select(`
        *,
        commander_tables (
          id,
          table_number,
          table_name
        )
      `)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (error || !display) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Display not found' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { display }
    });
  } catch (error) {
    console.warn('Get config error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to get config' }
    });
  }
}

async function handlePatch(req, res, deviceId) {
  // Verify staff authentication
  const staffSession = req.headers['x-staff-session'];
  if (!staffSession) {
    return res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' }
    });
  }

  const {
    table_id,
    device_name,
    device_type,
    display_mode,
    rotation_screens,
    rotation_interval,
    config
  } = req.body;

  try {
    const updates = { updated_at: new Date().toISOString() };

    if (table_id !== undefined) updates.table_id = table_id;
    if (device_name !== undefined) updates.device_name = device_name;
    if (device_type !== undefined) updates.device_type = device_type;
    if (display_mode !== undefined) updates.display_mode = display_mode;
    if (rotation_screens !== undefined) updates.rotation_screens = rotation_screens;
    if (rotation_interval !== undefined) updates.rotation_interval = rotation_interval;
    if (config !== undefined) updates.config = config;

    const { data: display, error } = await getSupabase()
      .from('commander_table_displays')
      .update(updates)
      .eq('device_id', deviceId)
      .select()
      .maybeSingle();

    if (error || !display) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Display not found' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { display }
    });
  } catch (error) {
    console.warn('Update config error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update config' }
    });
  }
}

async function handleDelete(req, res, deviceId) {
  // Verify staff authentication
  const staffSession = req.headers['x-staff-session'];
  if (!staffSession) {
    return res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' }
    });
  }

  try {
    const { error } = await getSupabase()
      .from('commander_table_displays')
      .delete()
      .eq('device_id', deviceId);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: { message: 'Display removed' }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Delete display error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to remove display' }
    });
  }
}
