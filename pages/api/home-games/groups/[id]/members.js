/**
 * Home Game Group Members API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/groups/[id]/members - List members
 * POST /api/commander/home-games/groups/[id]/members - Join/invite
 * PUT /api/commander/home-games/groups/[id]/members - Update membership
 * DELETE /api/commander/home-games/groups/[id]/members - Leave/remove
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/sentryWrap';
import { getUserScopedClient } from '../../../../../src/lib/home-games/rpcBridge';
import { respondToMembershipRpcError } from '../../../../../src/lib/home-games/membershipRpcError';
import {
  isHomeGamesUuid,
  parseMembershipDeleteIntent,
  resolveGroupMembershipAccess,
} from '../../../../../src/lib/home-games/membershipBoundary';
import {
  MEMBER_SELECT,
  normalizeJoinResult,
  toMemberDto,
} from '../../../../../src/lib/home-games/publicGroupBoundary';

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

    const { id: groupId } = req.query;

    if (!isHomeGamesUuid(groupId)) {
      return res.status(400).json({ success: false, error: 'Valid group ID required' });
    }

    if (req.method === 'GET') {
      return listMembers(req, res, groupId);
    }

    if (req.method === 'POST') {
      return joinOrInvite(req, res, groupId);
    }

    if (req.method === 'PUT') {
      return updateMembership(req, res, groupId);
    }

    if (req.method === 'DELETE') {
      return leaveOrRemove(req, res, groupId);
    }

    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listMembers(req, res, groupId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const { status } = req.query;

    // The group row is the canonical ownership record. An owner must retain
    // access even if the redundant owner membership row was never created or
    // was lost; this mirrors manage_home_group_member in World Home Games.
    const [groupResult, membershipResult] = await Promise.all([
      getSupabase()
        .from('commander_home_groups')
        .select('id, owner_id')
        .eq('id', groupId)
        .maybeSingle(),
      getSupabase()
        .from('commander_home_members')
        .select('role, status')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    if (groupResult.error) throw groupResult.error;
    if (membershipResult.error) throw membershipResult.error;
    if (!groupResult.data) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    const access = resolveGroupMembershipAccess({
      ownerId: groupResult.data.owner_id,
      userId: user.id,
      membership: membershipResult.data,
    });
    if (!access.isMember) {
      return res.status(403).json({ success: false, error: 'You are not a member of this group' });
    }

    let query = getSupabase()
      .from('commander_home_members')
      .select(MEMBER_SELECT)
      .eq('group_id', groupId)
      .order('joined_at', { ascending: false })
          .limit(100);

    // Only admins can see pending/declined members
    if (status && access.isManager) {
      query = query.eq('status', status)
          .limit(100);
    } else if (!access.isManager) {
      query = query.eq('status', 'approved');
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.status(200).json({
      members: (data || []).map(toMemberDto).filter(Boolean),
      my_role: access.role
    });
  } catch (error) {
    console.warn('List members error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function joinOrInvite(req, res, groupId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const { user_id, invite_code } = req.body || {};
    if (user_id && !isHomeGamesUuid(user_id)) {
      return res.status(400).json({ success: false, error: 'Valid user_id required' });
    }

    // Get group info
    const { data: group, error: groupError } = await getSupabase()
      .from('commander_home_groups')
      .select('id, owner_id, is_private, requires_approval, invite_code')
      .eq('id', groupId)
      .maybeSingle();

    if (groupError) throw groupError;
    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    // If inviting another user, check if requester is admin
    if (user_id && user_id !== user.id) {
      const { data: myMembership, error: membershipError } = await getSupabase()
        .from('commander_home_members')
        .select('role, status')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (membershipError) throw membershipError;

      const access = resolveGroupMembershipAccess({
        ownerId: group.owner_id,
        userId: user.id,
        membership: myMembership,
      });
      if (!access.isManager) {
        return res.status(403).json({ success: false, error: 'Only admins can invite members' });
      }

      // Check if target user exists
      const { data: targetUser, error: targetUserError } = await getSupabase()
        .from('profiles')
        .select('id')
        .eq('id', user_id)
        .maybeSingle();
      if (targetUserError) throw targetUserError;

      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // Invitations are membership creation, so they use the same
      // authenticated, atomic audit boundary as every later lifecycle action.
      const userClient = getUserScopedClient(token);
      const { data: inviteResult, error: inviteError } = await userClient.rpc(
        'manage_home_group_member',
        {
          p_group_id: groupId,
          p_member_user_id: user_id,
          p_action: 'invite',
          p_caller_user_id: user.id,
        }
      );
      if (inviteError) {
        if (respondToMembershipRpcError(res, inviteError)) return;
        throw inviteError;
      }
      if (!inviteResult?.success) {
        return res.status(409).json({ success: false, error: 'Member invitation was not applied' });
      }

      const { data: member, error } = await getSupabase()
        .from('commander_home_members')
        .select(MEMBER_SELECT)
        .eq('group_id', groupId)
        .eq('user_id', user_id)
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!member) {
        return res.status(502).json({ success: false, error: 'Invitation succeeded but membership could not be loaded' });
      }

      return res.status(201).json({
        success: true,
        member: toMemberDto(member),
        message: 'User invited successfully',
      });
    }

    // User joining themselves. CRITICAL: join_home_group checks
    //   auth.uid() <> p_caller_user_id → UNAUTHORIZED
    // so we must use a user-JWT-scoped client (not service role). And the
    // correct parameter name is p_caller_user_id, not p_user_id - the old
    // code triggered PostgREST 42883 "function does not exist" every time.
    const userClient = getUserScopedClient(token);
    const { data: result, error: rpcError } = await userClient.rpc('join_home_group', {
      p_group_id: groupId,
      p_caller_user_id: user.id,
      p_invite_code: invite_code || null
    });

    if (rpcError) {
      if (respondToMembershipRpcError(res, rpcError)) return;
      throw rpcError;
    }

    if (!result?.success) {
      switch (result?.error) {
        case 'INVALID_INVITE_CODE':
          return res.status(403).json({ success: false, error: 'Invite code is incorrect' });
        case 'RATE_LIMITED':
          return res.status(429).json({ success: false, error: 'Too many attempts. Try again in a few minutes.' });
        case 'BANNED':
          return res.status(403).json({ success: false, error: "You're banned from this group" });
        case 'DECLINED':
          return res.status(403).json({ success: false, error: 'The host has declined this membership request' });
        case 'ALREADY_MEMBER':
          return res.status(400).json({ success: false, error: 'You are already a member' });
        case 'PENDING_APPROVAL':
          return res.status(400).json({ success: false, error: 'Your membership request is pending approval' });
        default:
          return res.status(400).json({ success: false, error: result?.error || 'Failed to join group' });
      }
    }

    const normalized = normalizeJoinResult(result);
    if (!normalized) {
      return res.status(502).json({
        success: false,
        error: 'Join service returned an invalid membership state',
      });
    }

    const { status, membership: member } = normalized;
    const isApproved = status === 'approved';

    return res.status(201).json({
      success: true,
      status,
      member,
      membership: member,
      message: isApproved
        ? 'You have joined the group'
        : 'Your membership request is pending approval'
    });
  } catch (error) {
    console.warn('Join/invite error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function updateMembership(req, res, groupId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const { member_id, action, role } = req.body || {};

    if (!member_id || !action) {
      return res.status(400).json({ success: false, error: 'member_id and action required' });
    }

    if (!isHomeGamesUuid(member_id)) {
      return res.status(400).json({ success: false, error: 'Valid member_id required' });
    }

    const [groupResult, membershipResult] = await Promise.all([
      getSupabase()
        .from('commander_home_groups')
        .select('id, owner_id')
        .eq('id', groupId)
        .maybeSingle(),
      getSupabase()
        .from('commander_home_members')
        .select('role, status')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    if (groupResult.error) throw groupResult.error;
    if (membershipResult.error) throw membershipResult.error;
    if (!groupResult.data) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    const access = resolveGroupMembershipAccess({
      ownerId: groupResult.data.owner_id,
      userId: user.id,
      membership: membershipResult.data,
    });
    if (!access.isManager) {
      return res.status(403).json({ success: false, error: 'Only owners and admins can manage members' });
    }

    // Get target membership
    const { data: targetMember, error: targetMemberError } = await getSupabase()
      .from('commander_home_members')
      .select('id, user_id, role, status, is_roster_only')
      .eq('id', member_id)
      .eq('group_id', groupId)
      .maybeSingle();
    if (targetMemberError) throw targetMemberError;

    if (!targetMember) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }

    const targetIsOwner = targetMember.role === 'owner'
      || targetMember.user_id === groupResult.data.owner_id;
    if (targetIsOwner) {
      return res.status(403).json({ success: false, error: 'Cannot modify the owner' });
    }
    if (access.role === 'admin' && targetMember.role === 'admin') {
      return res.status(403).json({ success: false, error: 'Admins cannot modify another admin' });
    }

    let rpcAction = null;

    switch (action) {
      case 'approve':
        rpcAction = 'approve';
        break;

      case 'decline':
        rpcAction = 'decline';
        break;

      case 'ban':
        rpcAction = 'ban';
        break;

      case 'unban':
        rpcAction = 'unban';
        break;

      case 'set_role':
        if (!role || !['admin', 'member'].includes(role)) {
          return res.status(400).json({ success: false, error: 'Valid role required (admin, member)' });
        }
        if (role === 'owner') {
          return res.status(400).json({ success: false, error: 'Cannot assign owner role this way' });
        }
        rpcAction = role === 'admin' ? 'promote_admin' : 'demote_member';
        break;

      case 'set_can_host':
        if (typeof req.body.can_host !== 'boolean') {
          return res.status(400).json({ success: false, error: 'can_host must be true or false' });
        }
        rpcAction = req.body.can_host ? 'grant_host' : 'revoke_host';
        break;

      default:
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    // Every privileged member mutation goes through one authenticated,
    // database-audited lifecycle. For roster-only rows, user_id is null, so
    // the member row id is the target reference accepted by the RPC contract.
    const userClient = getUserScopedClient(token);
    const { data: rpcResult, error: rpcError } = await userClient.rpc(
      'manage_home_group_member',
      {
        p_group_id: groupId,
        p_member_user_id: targetMember.user_id || targetMember.id,
        p_action: rpcAction,
        p_caller_user_id: user.id,
      }
    );
    if (rpcError) {
      if (respondToMembershipRpcError(res, rpcError)) return;
      throw rpcError;
    }
    if (!rpcResult?.success) {
      return res.status(409).json({ success: false, error: 'Membership update was not applied' });
    }

    const { data: updated, error } = await getSupabase()
      .from('commander_home_members')
      .select(MEMBER_SELECT)
      .eq('id', member_id)
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      return res.status(502).json({ success: false, error: 'Membership was updated but could not be loaded' });
    }

    return res.status(200).json({ member: toMemberDto(updated) });
  } catch (error) {
    console.warn('Update membership error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function leaveOrRemove(req, res, groupId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const intent = parseMembershipDeleteIntent(req.body);
    if (!intent) {
      return res.status(400).json({
        success: false,
        code: 'MEMBERSHIP_DELETE_TARGET_REQUIRED',
        error: 'Provide member_id to remove a member or action "leave" to leave the group',
      });
    }

    if (intent.kind === 'leave') {
      const [groupResult, membershipResult] = await Promise.all([
        getSupabase()
          .from('commander_home_groups')
          .select('id, owner_id')
          .eq('id', groupId)
          .maybeSingle(),
        getSupabase()
          .from('commander_home_members')
          .select('id, role, status')
          .eq('group_id', groupId)
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);
      if (groupResult.error) throw groupResult.error;
      if (membershipResult.error) throw membershipResult.error;
      if (!groupResult.data) {
        return res.status(404).json({ success: false, error: 'Group not found' });
      }

      const myMembership = membershipResult.data;

      if (user.id === groupResult.data.owner_id || myMembership?.role === 'owner') {
        return res.status(400).json({ success: false, error: 'Owner cannot leave. Transfer ownership or delete the group.' });
      }
      if (!myMembership) {
        return res.status(404).json({ success: false, error: 'You are not a member of this group' });
      }

      const userClient = getUserScopedClient(token);
      const { data: leaveResult, error: leaveError } = await userClient.rpc(
        'leave_home_group',
        {
          p_group_id: groupId,
          p_caller_user_id: user.id,
        }
      );
      if (leaveError) {
        if (respondToMembershipRpcError(res, leaveError)) return;
        throw leaveError;
      }
      if (!leaveResult?.success) {
        return res.status(409).json({ success: false, error: 'Group leave was not applied' });
      }

      return res.status(200).json({ success: true, message: 'You have left the group' });
    }

    const member_id = intent.memberId;

    // Removing another member - check permissions against canonical owner_id
    // as well as approved membership roles.
    const [groupResult, membershipResult] = await Promise.all([
      getSupabase()
        .from('commander_home_groups')
        .select('id, owner_id')
        .eq('id', groupId)
        .maybeSingle(),
      getSupabase()
        .from('commander_home_members')
        .select('id, role, status')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    if (groupResult.error) throw groupResult.error;
    if (membershipResult.error) throw membershipResult.error;
    if (!groupResult.data) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    const access = resolveGroupMembershipAccess({
      ownerId: groupResult.data.owner_id,
      userId: user.id,
      membership: membershipResult.data,
    });
    if (!access.isManager) {
      return res.status(403).json({ success: false, error: 'Only owners and admins can remove members' });
    }

    const { data: targetMember, error: targetMemberError } = await getSupabase()
      .from('commander_home_members')
      .select('id, role, user_id, is_roster_only')
      .eq('id', member_id)
      .eq('group_id', groupId)
      .maybeSingle();
    if (targetMemberError) throw targetMemberError;

    if (!targetMember) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }

    if (targetMember.user_id === user.id) {
      return res.status(400).json({ success: false, error: 'Use the leave action to leave this group' });
    }

    if (targetMember.role === 'owner' || targetMember.user_id === groupResult.data.owner_id) {
      return res.status(403).json({ success: false, error: 'Cannot remove the owner' });
    }
    if (access.role === 'admin' && targetMember.role === 'admin') {
      return res.status(403).json({ success: false, error: 'Admins cannot remove another admin' });
    }

    const userClient = getUserScopedClient(token);
    const { data: removeResult, error: removeError } = await userClient.rpc(
      'manage_home_group_member',
      {
        p_group_id: groupId,
        p_member_user_id: targetMember.user_id || targetMember.id,
        p_action: 'remove',
        p_caller_user_id: user.id,
      }
    );
    if (removeError) {
      if (respondToMembershipRpcError(res, removeError)) return;
      throw removeError;
    }
    if (!removeResult?.success) {
      return res.status(409).json({ success: false, error: 'Member removal was not applied' });
    }

    return res.status(200).json({ success: true, message: 'Member removed' });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Leave/remove error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
