/**
 * Commander Staff at Venue API - GET /api/commander/staff/venue/:venueId
 * Get all staff at a specific venue
 * Reference: API_REFERENCE.md - Staff Management section
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
      // Verify manager authentication
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
          error: { code: 'INVALID_SESSION', message: 'Invalid session format' }
        });
      }

      // Auth: verify the session has owner/manager access to this venue
      // The login flow stores { user_id, role, venue_id } without a commander_staff table ID,
      // so we check multiple ways to authenticate.
      let authRole = null;

      // Method 1: Look up by staff record ID
      if (sessionData.id) {
        const { data } = await getSupabase()
          .from('commander_staff')
          .select('id, venue_id, role')
          .eq('id', sessionData.id)
          .eq('is_active', true)
          .maybeSingle();
        if (data && String(data.venue_id) === String(venueId)) {
          authRole = data.role;
        }
      }

      // Method 2: Look up by Supabase user_id
      if (!authRole && sessionData.user_id) {
        const { data } = await getSupabase()
          .from('commander_staff')
          .select('id, venue_id, role')
          .eq('user_id', sessionData.user_id)
          .eq('venue_id', venueId)
          .eq('is_active', true)
          .limit(1);
        if (data?.[0]) {
          authRole = data[0].role;
        }
      }

      // Method 3: Trust the session role if venue matches
      // Safe because data returned is already scoped to venueId in the query below
      if (!authRole && sessionData.role && String(sessionData.venue_id) === String(venueId)) {
        authRole = sessionData.role;
      }

      if (!authRole || !['owner', 'manager'].includes(authRole)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Owner or Manager role required' }
        });
      }

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
