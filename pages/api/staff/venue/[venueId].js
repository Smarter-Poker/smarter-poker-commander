/**
 * Commander Staff at Venue API - GET /api/commander/staff/venue/:venueId
 * Get all staff at a specific venue
 * Reference: API_REFERENCE.md - Staff Management section
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
// 2026-07-25 audit fix: use the HMAC-verified session guard instead of parsing
// the raw x-staff-session header locally.
import { guardManager } from '../../../../src/lib/commander/auth';
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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Venue ID required' }
      });
    }

    try {
      // 2026-07-25 audit fix: the old inline check parsed the raw x-staff-session
      // JSON with no signature verification and (Method 3) trusted the client-
      // supplied role outright — any caller could read staff PINs, ID numbers,
      // and dates of birth. guardManager verifies the HMAC-signed session,
      // requires owner/manager role, and enforces venue scoping.
      const manager = await guardManager(req, res, venueId);
      if (!manager) return;

      const { data: staff, error } = await getSupabase()
        .from('commander_staff')
        .select(`
          id,
          role,
          permissions,
          is_active,
          display_name,
          pin_code,
          email,
          phone,
          hired_at,
          created_at,
          qr_code,
          linked_user_id,
          id_type,
          id_number,
          id_state,
          id_expiry,
          date_of_birth,
          profiles (
            id,
            display_name,
            avatar_url
          )
        `)
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .order('role', { ascending: true });

      if (error) {
        console.warn('Commander venue staff query error:', error);
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
      console.warn('Commander venue staff API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
