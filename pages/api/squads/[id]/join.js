/**
 * Join Squad API
 * POST /api/commander/squads/:id/join
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


    // Auth guard: require user auth for writes
    if (req.method !== "GET") { const _user = await guardUser(req, res); if (!_user) return; }
    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { id } = req.query;
    const { player_id, invite_code } = req.body;

    if (!player_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'player_id required' }
      });
    }

    try {
      // Get squad
      const { data: squad, error: squadError } = await getSupabase()
        .from('commander_waitlist_groups')
        .select(`
          *,
          commander_waitlist_group_members (id, player_id)
        `)
        .eq('id', id)
        .maybeSingle();

      if (squadError || !squad) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Squad not found' }
        });
      }

      // Check if already a member
      const alreadyMember = squad.commander_waitlist_group_members?.some(
        m => m.player_id === player_id
      );
      if (alreadyMember) {
        return res.status(400).json({
          success: false,
          error: { code: 'ALREADY_MEMBER', message: 'Already in this squad' }
        });
      }

      // Add member
      const { data: member, error: memberError } = await getSupabase()
        .from('commander_waitlist_group_members')
        .insert({
          group_id: id,
          player_id
        })
        .select()
        .maybeSingle();

      if (memberError) throw memberError;

      return res.status(200).json({
        success: true,
        data: { member }
      });
    } catch (error) {
      console.warn('Join squad error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to join squad' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
