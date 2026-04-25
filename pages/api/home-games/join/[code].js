/**
 * Join Club by Code API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/join/[code] - Get club info by code
 * POST /api/commander/home-games/join/[code] - Join club by code
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { getUserScopedClient } from '../../../../src/lib/home-games/rpcBridge';

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

    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ error: 'Club code required' });
    }

    if (req.method === 'GET') {
      return getClubByCode(req, res, code);
    }

    if (req.method === 'POST') {
      return joinClubByCode(req, res, code);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getClubByCode(req, res, code) {
  try {
    const upperCode = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!upperCode) return res.status(400).json({ error: 'Invalid club code format' });

    // Try club_code first (6 chars), then invite_code (8 chars)
    let { data: group, error } = await getSupabase()
      .from('commander_home_groups')
      .select(`
        id,
        name,
        description,
        club_code,
        is_private,
        city,
        state,
        default_game_type,
        default_stakes,
        member_count,
        frequency,
        profiles:owner_id (id, display_name, avatar_url)
      `)
      .or(`club_code.eq.${upperCode},invite_code.eq.${upperCode}`)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !group) {
      return res.status(404).json({ error: 'Club not found. Check the code and try again.' });
    }

    // Check if user is already a member (if logged in)
    const authHeader = req.headers.authorization;
    let myMembership = null;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (user) {
        const { data: membership } = await getSupabase()
          .from('commander_home_members')
          .select('status, role')
          .eq('group_id', group.id)
          .eq('user_id', user.id)
          .maybeSingle();

        myMembership = membership;
      }
    }

    return res.status(200).json({
      group,
      my_membership: myMembership,
      can_join: !myMembership || myMembership.status === 'declined'
    });
  } catch (error) {
    console.warn('Get club by code error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function joinClubByCode(req, res, code) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Please log in to join a club' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const upperCode = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!upperCode) return res.status(400).json({ error: 'Invalid club code format' });

    // Find group
    const { data: group, error: groupError } = await getSupabase()
      .from('commander_home_groups')
      .select('id, name, requires_approval, invite_code, club_code')
      .or(`club_code.eq.${upperCode},invite_code.eq.${upperCode}`)
      .eq('is_active', true)
      .maybeSingle();

    if (groupError || !group) {
      return res.status(404).json({ error: 'Club not found. Check the code and try again.' });
    }

    // Use the RPC for Phase 40. CRITICAL: join_home_group internally does
    //   IF auth.uid() IS NULL OR (auth.uid() <> p_caller_user_id) THEN RAISE UNAUTHORIZED
    // so we MUST invoke it via a user-JWT-scoped client (anon key + caller's
    // Bearer token) rather than the service-role client — otherwise auth.uid()
    // is NULL and the RPC rejects every join. The parameter name is also
    // `p_caller_user_id`, not `p_user_id` (earlier code passed the wrong name
    // and PostgREST returned "function does not exist" 42883).
    const userClient = getUserScopedClient(token);
    const { data: result, error: rpcError } = await userClient.rpc('join_home_group', {
      p_group_id: group.id,
      p_caller_user_id: user.id,
      p_invite_code: code
    });

    if (rpcError) {
      throw rpcError; // Hard error
    }

    if (!result.success) {
      // Soft failures mapped to friendly messages
      switch (result.error) {
        case 'INVALID_INVITE_CODE':
          return res.status(403).json({ error: 'Invite code is incorrect' });
        case 'RATE_LIMITED':
          return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
        case 'BANNED':
          return res.status(403).json({ error: "You're banned from this group" });
        case 'ALREADY_MEMBER':
          return res.status(400).json({ error: 'You are already a member of this club' });
        case 'PENDING_APPROVAL':
          return res.status(400).json({ error: 'Your membership request is pending approval' });
        default:
          return res.status(400).json({ error: result.error || 'Failed to join group' });
      }
    }

    // Success response should mimic the expected return structure from the RPC,
    // which likely contains the membership object
    const status = result.membership?.status || 'approved';
    return res.status(200).json({
      membership: result.membership,
      group: { id: group.id, name: group.name },
      message: status === 'approved'
        ? `Welcome to ${group.name}!`
        : `Your request to join ${group.name} is pending approval`
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Join club by code error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
