/**
 * Commander Staff API - GET/POST /api/commander/staff
 * List or add staff members
 * Reference: API_REFERENCE.md - Staff Management section
 */
import crypto from 'crypto';
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

    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
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

async function handleGet(req, res) {
  try {
    const { venue_id } = req.query;

    if (!venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'venue_id is required' }
      });
    }

    // Verify manager authentication
    const authResult = await verifyManagerSession(req, venue_id);
    if (authResult.error) {
      return res.status(authResult.error.status).json({
        success: false,
        error: { code: authResult.error.code, message: authResult.error.message }
      });
    }

    const { data: staff, error } = await getSupabase()
      .from('commander_staff')
      .select(`
        *,
        profiles (
          id,
          display_name,
          avatar_url
        )
      `)
      .eq('venue_id', venue_id)
      .eq('is_active', true)
      .order('role', { ascending: true });

    if (error) {
      console.warn('Commander staff list error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch staff' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { staff: staff || [] }
    });
  } catch (error) {
    console.warn('Commander staff GET error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handlePost(req, res) {
  try {
    const { venue_id: bodyVenueId } = req.body;

    // Redundant verification removed because _middleware.ts handles `guardWriteStaff()`

    const {
      venue_id,
      user_id,
      display_name: _displayName,
      name,
      email,
      phone,
      role,
      permissions = {},
      pin_code,
      id_type,
      id_number,
      id_state,
      id_expiry,
      photo_url,
      date_of_birth,
    } = req.body;

    const display_name = _displayName || name;

    // Validation — require venue_id, role, and either user_id or display_name
    if (!venue_id || !role) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'venue_id and role are required'
        }
      });
    }

    if (!user_id && !display_name) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Either user_id or display_name (or name) is required'
        }
      });
    }

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`
        }
      });
    }

    // Verify venue exists
    const { data: venue, error: venueError } = await getSupabase()
      .from('poker_venues')
      .select('id, name')
      .eq('id', venue_id)
      .maybeSingle();

    if (venueError || !venue) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Venue not found' }
      });
    }

    // If user_id provided, verify user exists and check for duplicates
    if (user_id) {
      const { data: user, error: userError } = await getSupabase()
        .from('profiles')
        .select('id')
        .eq('id', user_id)
        .maybeSingle();

      if (userError || !user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' }
        });
      }

      const { data: existing } = await getSupabase()
        .from('commander_staff')
        .select('id')
        .eq('venue_id', venue_id)
        .eq('user_id', user_id)
        .maybeSingle();

      if (existing) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'User is already staff at this venue' }
        });
      }
    }

    // Create staff record — user_id is optional for name-only employees
    // Check for duplicate PIN at this venue
    if (pin_code) {
      const { data: existingPin } = await getSupabase()
        .from('commander_staff')
        .select('id')
        .eq('venue_id', venue_id)
        .eq('pin_code', pin_code)
        .eq('is_active', true)
        .limit(1);
      if (existingPin?.length > 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'DUPLICATE_PIN', message: 'This PIN is already in use by another employee at this venue' }
        });
      }
    }

    // Generate unique QR code for this staff member
    const qrCode = `STAFF-${venue_id}-${crypto.randomUUID().split('-')[0]}`;

    // Auto-create a member record (dual-registration: staff = player)
    let memberId = null;
    try {
      const prefix = (venue?.name || 'CLUB').replace(/[^A-Za-z]/g, '').substring(0, 4).toUpperCase();
      const { count } = await getSupabase()
        .from('commander_members')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venue_id);
      const memberNumber = `${prefix}-${String((count || 0) + 1).padStart(5, '0')}`;

      const nameParts = (display_name || '').trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const { data: member } = await getSupabase()
        .from('commander_members')
        .insert({
          venue_id,
          member_number: memberNumber,
          qr_code: qrCode,
          first_name: firstName,
          last_name: lastName,
          email: email?.trim() || null,
          phone: phone?.trim() || null,
          date_of_birth: date_of_birth || null,
          id_type: id_type || null,
          id_number: id_number?.trim() || null,
          id_state: id_state || null,
          id_expiry: id_expiry || null,
          photo_url: photo_url || null,
          membership_tier: 'staff',
          membership_status: 'active',
          notes: `Staff member — ${role}`,
        })
        .select('id')
        .maybeSingle();
      if (member) memberId = member.id;
    } catch (err) {
      console.warn('Auto-create member failed (non-critical):', err.message);
    }

    const staffRecord = {
      venue_id,
      role,
      permissions,
      pin_code: pin_code || null,
      is_active: true,
      display_name: display_name || null,
      email: email || null,
      phone: phone || null,
      qr_code: qrCode,
      member_id: memberId,
      id_type: id_type || null,
      id_number: id_number?.trim() || null,
      id_state: id_state || null,
      id_expiry: id_expiry || null,
      photo_url: photo_url || null,
      date_of_birth: date_of_birth || null,
    };
    if (user_id) {
      staffRecord.user_id = user_id;
    }

    const { data: staff, error: insertError } = await getSupabase()
      .from('commander_staff')
      .insert(staffRecord)
      .select()
      .maybeSingle();

    if (insertError) {
      console.warn('Commander staff insert error:', insertError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to add staff member' }
      });
    }

    const authResult = await verifyManagerSession(req, venue_id);
    if (!authResult.error && authResult.staff) {
      await logAction(AuditActions.STAFF_CREATE, {
        venueId: venue_id,
        staffId: authResult.staff.id,
        targetId: staff.id,
        targetType: 'commander_staff',
        targetName: staff.display_name || 'Staff',
        req
      });
    }

    return res.status(201).json({
      success: true,
      data: { staff }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Commander staff POST error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
