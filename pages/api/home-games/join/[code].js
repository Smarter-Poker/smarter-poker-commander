/**
 * Join Club by Code API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/join/[code] - Get club info by code
 * POST /api/commander/home-games/join/[code] - Join club by code
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { getUser, guardUser } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { getUserScopedClient } from '../../../../src/lib/home-games/rpcBridge';
import {
  allowsDeclinedReRequest,
  normalizeJoinResult,
  toPublicGroup,
} from '../../../../src/lib/home-games/publicGroupBoundary';

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
    if (req.method === 'GET') {
      if (!applyRateLimit(req, res, LIMITS.read)) return;
    } else if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
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
    if (!upperCode || upperCode.length > 64) {
      return res.status(400).json({ error: 'Invalid club code format' });
    }

    // Try club_code first (6 chars), then invite_code (8 chars)
    let { data: group, error } = await getSupabase()
      .from('commander_home_groups')
      .select(`
        id,
        name,
        description,
        tagline,
        owner_id,
        club_code,
        is_private,
        requires_approval,
        city,
        state,
        default_game_type,
        default_stakes,
        member_count,
        frequency,
        cover_photo_url,
        profile_photo_url,
        created_at,
        settings,
        profiles:owner_id (id, display_name, avatar_url)
      `)
      .or(`club_code.eq.${upperCode},invite_code.eq.${upperCode}`)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !group) {
      return res.status(404).json({ error: 'Club not found. Check the code and try again.' });
    }

    // Check if user is already a member (if logged in)
    let myMembership = null;

    const user = await getUser(req, res);
    if (user) {
      const { data: membership, error: membershipError } = await getSupabase()
        .from('commander_home_members')
        .select('status, role')
        .eq('group_id', group.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (membershipError) throw membershipError;

      myMembership = membership;
    }

    const allowDeclined = allowsDeclinedReRequest(group.settings);
    return res.status(200).json({
      group: toPublicGroup(group),
      my_membership: myMembership,
      can_join: !myMembership || (
        myMembership.status === 'declined' && allowDeclined
      ),
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
    if (!upperCode || upperCode.length > 64) {
      return res.status(400).json({ error: 'Invalid club code format' });
    }

    // Find group
    const { data: group, error: groupError } = await getSupabase()
      .from('commander_home_groups')
      .select('id, name')
      .or(`club_code.eq.${upperCode},invite_code.eq.${upperCode}`)
      .eq('is_active', true)
      .maybeSingle();

    if (groupError || !group) {
      return res.status(404).json({ error: 'Club not found. Check the code and try again.' });
    }

    // Use the RPC for Phase 40. CRITICAL: join_home_group internally does
    //   IF auth.uid() IS NULL OR (auth.uid() <> p_caller_user_id) THEN RAISE UNAUTHORIZED
    // so we MUST invoke it via a user-JWT-scoped client (anon key + caller's
    // Bearer token) rather than the service-role client - otherwise auth.uid()
    // is NULL and the RPC rejects every join. The parameter name is also
    // `p_caller_user_id`, not `p_user_id` (earlier code passed the wrong name
    // and PostgREST returned "function does not exist" 42883).
    const userClient = getUserScopedClient(token);
    const { data: result, error: rpcError } = await userClient.rpc('join_home_group', {
      p_group_id: group.id,
      p_caller_user_id: user.id,
      p_invite_code: upperCode,
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
        case 'DECLINED':
          return res.status(403).json({ error: 'The host has declined this membership request' });
        case 'ALREADY_MEMBER':
          return res.status(400).json({ error: 'You are already a member of this club' });
        case 'PENDING_APPROVAL':
          return res.status(400).json({ error: 'Your membership request is pending approval' });
        default:
          return res.status(400).json({ error: result.error || 'Failed to join group' });
      }
    }

    // join_home_group returns status/member_id at the top level. The old
    // adapter looked only for result.membership.status and defaulted any
    // unfamiliar success payload to approved, so a pending private request
    // was displayed as immediate membership.
    const normalized = normalizeJoinResult(result);
    if (!normalized) {
      return res.status(502).json({ error: 'Join service returned an invalid membership state' });
    }

    const { status, membership } = normalized;
    return res.status(200).json({
      status,
      membership,
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
