/**
 * Single Staff API - PATCH/DELETE /api/commander/staff/[id]
 * Update or deactivate a staff member
 * Reference: API_REFERENCE.md - Staff Management section
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { verifyManagerSession } from '../../../src/lib/commander/auth';
import { logAction, AuditActions } from '../../../src/lib/commander/audit';
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

const VALID_ROLES = ['owner', 'manager', 'dualrate', 'floor', 'cashier', 'brush', 'dealer', 'security'];

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Staff ID required' }
      });
    }

    switch (req.method) {
      case 'PATCH':
        return handlePatch(req, res, id);
      case 'DELETE':
        return handleDelete(req, res, id);
      default:
        return res.status(405).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
        });
    }

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handlePatch(req, res, id) {
  try {
    // Fetch the target staff member to get venue_id
    const { data: target, error: fetchError } = await getSupabase()
      .from('commander_staff')
      .select('id, venue_id, role')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !target) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Staff member not found' }
      });
    }

    // 2026-07-25 audit fix (P0): auth had been deleted behind a comment
    // claiming middleware covered this route - it does not. Unauthenticated
    // callers could escalate roles, reset PINs, or deactivate staff.
    const authResult = await verifyManagerSession(req, target.venue_id);
    if (authResult.error) {
      return res.status(authResult.error.status).json({
        success: false,
        error: { code: authResult.error.code, message: authResult.error.message }
      });
    }

    const { role, permissions, pin_code, is_active, display_name, email, phone, id_type, id_number, id_state, id_expiry, date_of_birth } = req.body;

    // Validate role if provided
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }
      });
    }

    const updates = {};
    if (role !== undefined) updates.role = role;
    if (permissions !== undefined) updates.permissions = permissions;
    if (display_name !== undefined) updates.display_name = display_name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (id_type !== undefined) updates.id_type = id_type;
    if (id_number !== undefined) updates.id_number = id_number;
    if (id_state !== undefined) updates.id_state = id_state;
    if (id_expiry !== undefined) updates.id_expiry = id_expiry;
    if (date_of_birth !== undefined) updates.date_of_birth = date_of_birth;
    if (pin_code !== undefined) {
      // Check for duplicate PIN at this venue (exclude self)
      if (pin_code) {
        // Duplicate-PIN check happens in the database via fn_staff_pin_taken, which
        // compares the bcrypt pin_hash rather than reading the plaintext pin_code column.
        const { data: pinTaken, error: pinCheckError } = await getSupabase()
          .rpc('fn_staff_pin_taken', {
            p_venue_id: String(target.venue_id),
            p_pin: String(pin_code),
            p_exclude_id: id
          });
        if (pinCheckError) {
          console.warn('[staff] duplicate-PIN check failed:', pinCheckError.message || pinCheckError);
        }
        if (pinTaken) {
          return res.status(400).json({
            success: false,
            error: { code: 'DUPLICATE_PIN', message: 'This PIN is already in use by another employee at this venue' }
          });
        }
      }
      updates.pin_code = pin_code;
    }
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates || {}).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' }
      });
    }

    const { data: staff, error: updateError } = await getSupabase()
      .from('commander_staff')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        profiles (
          id,
          display_name,
          avatar_url
        )
      `)
      .maybeSingle();

    if (updateError) {
      console.warn('Commander staff update error:', updateError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to update staff member' }
      });
    }

    // 2026-07-25 audit fix: reuse the manager session verified at the top of
    // this handler (previously this call was audit-logging only, not a gate).
    if (authResult.staff) {
      await logAction(AuditActions.STAFF_UPDATE, {
        venueId: target.venue_id,
        staffId: authResult.staff.id,
        targetId: id,
        targetType: 'commander_staff',
        targetName: staff.display_name || 'Staff',
        changes: updates,
        req
      });
    }

    return res.status(200).json({
      success: true,
      data: { staff }
    });
  } catch (error) {
    console.warn('Commander staff PATCH error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handleDelete(req, res, id) {
  try {
    // Fetch the target staff member to get venue_id
    const { data: target, error: fetchError } = await getSupabase()
      .from('commander_staff')
      .select('id, venue_id, role')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !target) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Staff member not found' }
      });
    }

    // 2026-07-25 audit fix (P0): auth restored - middleware never covered
    // this route; anyone could deactivate any staff member (incl. the owner).
    const authResult = await verifyManagerSession(req, target.venue_id);
    if (authResult.error) {
      return res.status(authResult.error.status).json({
        success: false,
        error: { code: authResult.error.code, message: authResult.error.message }
      });
    }

    // Prevent removing yourself
    if (String(authResult.staff.id) === String(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'You cannot deactivate your own staff account' }
      });
    }

    // Soft delete - deactivate rather than hard delete
    const { data: staff, error: deleteError } = await getSupabase()
      .from('commander_staff')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (deleteError) {
      console.warn('Commander staff delete error:', deleteError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to remove staff member' }
      });
    }

    // 2026-07-25 audit fix: reuse the manager session verified at the top of
    // this handler (previously this call was audit-logging only, not a gate).
    if (authResult.staff) {
      await logAction(AuditActions.STAFF_DELETE, {
        venueId: target.venue_id,
        staffId: authResult.staff.id,
        targetId: id,
        targetType: 'commander_staff',
        targetName: staff.display_name || 'Staff',
        req
      });
    }

    return res.status(200).json({
      success: true,
      data: { staff, message: 'Staff member deactivated' }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Commander staff DELETE error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
