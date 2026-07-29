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


    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    // 2026-07-25 audit fix: the joining player is the verified session user —
    // body player_id was forgeable and is now ignored. Body may be entirely
    // absent (the accept-invitation flow sends none).
    const user = await guardUser(req, res);
    if (!user) return;

    const { id } = req.query;
    const { invite_code } = req.body || {};
    const player_id = user.id;

    try {
      // Get squad
      // 2026-07-29 wiring fix: commander_waitlist_group_members has no FK to
      // commander_waitlist_groups, so members cannot be embedded off the group
      // (errors PGRST200). Fetch the group and its members separately.
      const { data: squad, error: squadError } = await getSupabase()
        .from('commander_waitlist_groups')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (squadError || !squad) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Squad not found' }
        });
      }

      const { data: memberRows } = await getSupabase()
        .from('commander_waitlist_group_members')
        .select('id, player_id, member_status')
        .eq('group_id', id);
      const members = memberRows || [];
      const existing = members.find(m => String(m.player_id) === String(player_id));

      // Accept-invitation path: an 'invited' row for this user becomes active.
      if (existing) {
        if (existing.member_status === 'invited') {
          const { data: member, error: acceptError } = await getSupabase()
            .from('commander_waitlist_group_members')
            .update({ member_status: 'active' })
            .eq('id', existing.id)
            .select()
            .maybeSingle();
          if (acceptError) throw acceptError;
          return res.status(200).json({ success: true, data: { member } });
        }
        return res.status(400).json({
          success: false,
          error: { code: 'ALREADY_MEMBER', message: 'Already in this squad' }
        });
      }

      // 2026-07-25 audit fix: private squads require a matching invite code
      // (case-insensitive) unless the user was explicitly invited above.
      if (squad.is_private) {
        const provided = String(invite_code || '').trim().toUpperCase();
        const actual = String(squad.invite_code || '').trim().toUpperCase();
        if (!actual || !provided || provided !== actual) {
          return res.status(403).json({
            success: false,
            error: { code: 'INVITE_CODE_REQUIRED', message: 'Valid invite code required to join this squad' }
          });
        }
      }

      // Capacity check
      const activeCount = members.filter(m => m.member_status !== 'removed' && m.member_status !== 'declined' && m.member_status !== 'left').length;
      if (squad.max_size && activeCount >= squad.max_size) {
        return res.status(400).json({
          success: false,
          error: { code: 'SQUAD_FULL', message: 'Squad is full' }
        });
      }

      // Add member
      const { data: member, error: memberError } = await getSupabase()
        .from('commander_waitlist_group_members')
        .insert({
          group_id: id,
          player_id,
          member_status: 'active'
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
