/**
 * Check Player Exclusion Status API
 * GET /api/commander/responsible-gaming/check/:playerId
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    const { playerId } = req.query;
    const { venue_id } = req.query;

    try {
      // Check for active exclusions (not yet expired + not lifted)
      // 2026-07-25 audit fix: .gte('expires_at', now) silently missed permanent
      // exclusions (null expires_at). Match the enforcement queries: not lifted
      // AND (no expiry OR expiry in the future).
      let query = getSupabase()
        .from('commander_self_exclusions')
        .select('*')
        .eq('player_id', playerId)
        .is('lifted_at', null)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
            .limit(100);

      // Check venue-specific or global exclusions
      if (venue_id) {
        // BUG #270 FIX: Sanitize to prevent PostgREST filter injection
        const safeVenueId = String(venue_id).replace(/[^a-zA-Z0-9-]/g, '');
        if (safeVenueId) {
          query = query.or(`venue_id.eq.${safeVenueId},venue_id.is.null`)
              .limit(100);
        }
      }

      const { data: exclusions, error } = await query;

      if (error) throw error;

      const isExcluded = exclusions && exclusions.length > 0;
      const activeExclusion = isExcluded ? exclusions[0] : null;

      // Also check spending limits (all limits are active if they exist)
      const { data: limits } = await getSupabase()
        .from('commander_spending_limits')
        .select('*')
        .eq('player_id', playerId)
        .maybeSingle();

      // Check current spending against limits
      let limitReached = false;
      let limitType = null;

      if (limits) {
        const { data: sessions } = await getSupabase()
          .from('commander_player_sessions')
          .select('total_buyin')
          .eq('player_id', playerId)
          .gte('check_in_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

        if (sessions) {
          const dailyTotal = sessions.reduce((sum, s) => sum + (s.total_buyin || 0), 0);
          if (limits.daily_limit && dailyTotal >= limits.daily_limit) {
            limitReached = true;
            limitType = 'daily';
          }
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          is_excluded: isExcluded,
          exclusion: activeExclusion,
          limit_reached: limitReached,
          limit_type: limitType,
          can_play: !isExcluded && !limitReached
        }
      });
    } catch (error) {
      console.warn('Check exclusion error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to check status' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
