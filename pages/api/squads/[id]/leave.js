/**
 * Leave Squad API
 * POST /api/commander/squads/:id/leave
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    if (req.method !== 'GET') { const _u = await guardUser(req, res); if (!_u) return; }

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { id } = req.query;

    try {
      // Get authenticated user via Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' }
        });
      }

      // Get squad
      const { data: squad, error: squadError } = await getSupabase()
        .from('commander_waitlist_groups')
        .select('id, leader_id, status')
        .eq('id', id)
        .maybeSingle();

      if (squadError || !squad) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Squad not found' }
        });
      }

      // Check if user is the leader
      if (squad.leader_id === user.id) {
        return res.status(400).json({
          success: false,
          error: { code: 'LEADER_CANNOT_LEAVE', message: 'Leader cannot leave. Disband the squad instead.' }
        });
      }

      // Check if squad is still forming (not yet submitted to waitlist)
      if (squad.status !== 'forming') {
        return res.status(400).json({
          success: false,
          error: { code: 'CANNOT_LEAVE', message: 'Cannot leave squad after joining waitlist' }
        });
      }

      // Remove member
      const { error: deleteError } = await getSupabase()
        .from('commander_waitlist_group_members')
        .delete()
        .eq('group_id', id)
        .eq('player_id', user.id);

      if (deleteError) throw deleteError;

      return res.status(200).json({
        success: true,
        data: { message: 'Left squad successfully' }
      });
    } catch (error) {
      console.warn('Leave squad error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to leave squad' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
