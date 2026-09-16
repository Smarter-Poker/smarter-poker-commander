/**
 * Decline Squad Invitation API
 * POST /api/commander/squads/[id]/decline - Decline a squad invitation
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    if (req.method !== 'GET') { const _u = await guardUser(req, res); if (!_u) return; }

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    const { id } = req.query;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
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

    try {
      // Find the membership record
      const { data: membership, error: findError } = await getSupabase()
        .from('commander_waitlist_group_members')
        .select('id')
        .eq('group_id', id)
        .eq('player_id', user.id)
        .maybeSingle();

      if (findError || !membership) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Membership not found' }
        });
      }

      // Remove the member record (decline = leave the squad)
      const { error: deleteError } = await getSupabase()
        .from('commander_waitlist_group_members')
        .delete()
        .eq('id', membership.id);

      if (deleteError) throw deleteError;

      return res.status(200).json({
        success: true,
        data: { message: 'Invitation declined' }
      });
    } catch (error) {
      console.warn('Decline squad invitation error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to decline invitation' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
