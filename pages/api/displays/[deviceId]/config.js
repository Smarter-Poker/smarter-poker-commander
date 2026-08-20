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

// Auth: STAFF - requires valid staff session
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
      // 2026-07-25 audit fix: pass the verified staff for venue scoping
      return handlePatch(req, res, deviceId, _staff);
    } else if (req.method === 'DELETE') {
      return handleDelete(req, res, deviceId, _staff);
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

async function handlePatch(req, res, deviceId, staff) {
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
    // 2026-07-25 audit fix: the display must belong to the staff member's
    // venue - a valid session at any venue could previously edit any display.
    const { data: existing, error: loadError } = await getSupabase()
      .from('commander_table_displays')
      .select('id, venue_id')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (loadError || !existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Display not found' }
      });
    }
    if (String(existing.venue_id) !== String(staff.venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' }
      });
    }

    // 2026-07-25 audit fix: dropped updated_at - commander_table_displays has
    // no such column and the write errored against production.
    const updates = {};

    if (table_id !== undefined) updates.table_id = table_id;
    if (device_name !== undefined) updates.device_name = device_name;
    if (device_type !== undefined) updates.device_type = device_type;
    if (display_mode !== undefined) updates.display_mode = display_mode;
    if (rotation_screens !== undefined) updates.rotation_screens = rotation_screens;
    if (rotation_interval !== undefined) updates.rotation_interval = rotation_interval;
    if (config !== undefined) updates.config = config;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No fields to update' }
      });
    }

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

async function handleDelete(req, res, deviceId, staff) {
  try {
    // 2026-07-25 audit fix: the display must belong to the staff member's venue
    const { data: existing, error: loadError } = await getSupabase()
      .from('commander_table_displays')
      .select('id, venue_id')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (loadError || !existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Display not found' }
      });
    }
    if (String(existing.venue_id) !== String(staff.venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' }
      });
    }

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
