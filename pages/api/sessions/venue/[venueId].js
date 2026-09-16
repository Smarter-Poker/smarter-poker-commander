/**
 * Commander Sessions by Venue API
 * GET /api/commander/sessions/venue/[venueId] - List active sessions at a venue
 * Reference: Phase 2 - Session Tracking
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { captureException } from '../../../../src/lib/commander/errorMonitoring';
import { guardStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF on EVERY method, reads included.
// 2026-08-20 audit fix: this route is GET-only and used guardWriteStaff, which
// returns `true` for GET without verifying anything - every active player
// session at any venue (names, buy-ins, comps, notes) was public.
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const _authResult = await guardStaff(req, res);
    if (!_authResult) return;

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
        error: { code: 'VALIDATION_ERROR', message: 'venueId is required' }
      });
    }

    if (_authResult.venue_id !== undefined && _authResult.venue_id !== null
        && String(_authResult.venue_id) !== String(venueId)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' }
      });
    }

    try {
      const { status = 'active', limit = 100 } = req.query;

      let query = getSupabase()
        .from('commander_player_sessions')
        .select(`
          *,
          profiles (
            id,
            display_name,
            avatar_url
          )
        `)
        .eq('venue_id', venueId)
        .order('check_in_at', { ascending: false })
        .limit(Math.min(parseInt(limit) || 50, 500));

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        console.warn('Commander sessions by venue query error:', error);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to fetch sessions' }
        });
      }

      return res.status(200).json({
        success: true,
        data: { sessions: data || [] }
      });
    } catch (error) {
      captureException(error, {
        action: 'sessions_by_venue',
        endpoint: `/api/commander/sessions/venue/${venueId}`,
        venue_id: venueId
      });
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
