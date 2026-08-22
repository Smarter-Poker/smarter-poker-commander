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

    const { id: groupId } = req.query;

    if (!groupId) {
      return res.status(400).json({ success: false, error: 'Group ID required' });
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

    // Check if user is a member
    const { data: myMembership } = await getSupabase()
      .from('commander_home_members')
      .select('role, status')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!myMembership || myMembership.status !== 'approved') {
      return res.status(403).json({ success: false, error: 'You are not a member of this group' });
    }

    let query = getSupabase()
      .from('commander_home_members')
      .select(`
        *,
        profiles:user_id (id, display_name, avatar_url)
      `)
      .eq('group_id', groupId)
      .order('joined_at', { ascending: false })
          .limit(100);

    // Only admins can see pending/declined members
    if (status && (myMembership.role === 'owner' || myMembership.role === 'admin')) {
      query = query.eq('status', status)
          .limit(100);
    } else if (myMembership.role !== 'owner' && myMembership.role !== 'admin') {
      query = query.eq('status', 'approved');
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.status(200).json({
      members: data,
      my_role: myMembership.role
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

    const { user_id, invite_code } = req.body;

    // Get group info
    const { data: group, error: groupError } = await getSupabase()
      .from('commander_home_groups')
      .select('id, owner_id, is_private, requires_approval, invite_code')
      .eq('id', groupId)
      .maybeSingle();

    if (groupError || !group) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    // If inviting another user, check if requester is admin
    if (user_id && user_id !== user.id) {
      const { data: myMembership } = await getSupabase()
        .from('commander_home_members')
        .select('role')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .eq('status', 'approved')
        .maybeSingle();

      if (!myMembership || (myMembership.role !== 'owner' && myMembership.role !== 'admin')) {
        return res.status(403).json({ success: false, error: 'Only admins can invite members' });
      }

      // Check if target user exists
      const { data: targetUser } = await getSupabase()
        .from('profiles')
        .select('id')
        .eq('id', user_id)
        .maybeSingle();

      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // Add invited user
      const { data: member, error } = await getSupabase()
        .from('commander_home_members')
        .insert({
          group_id: groupId,
          user_id: user_id,
          role: 'member',
          status: 'approved', // Direct invite = auto-approved
          invited_by: user.id,
          joined_at: new Date().toISOString()
        })
        .select(`
          *,
          profiles:user_id (id, display_name, avatar_url)
        `)
        .maybeSingle();

      if (error) {
        if (error.code === '23505') {
          return res.status(400).json({ success: false, error: 'User is already a member' });
        }
        throw error;
      }

      return res.status(201).json({ member, message: 'User invited successfully' });
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

    if (rpcError) throw rpcError;

    if (!result.success) {
      switch (result.error) {
        case 'INVALID_INVITE_CODE':
          return res.status(403).json({ success: false, error: 'Invite code is incorrect' });
        case 'RATE_LIMITED':
          return res.status(429).json({ success: false, error: 'Too many attempts. Try again in a few minutes.' });
        case 'BANNED':
          return res.status(403).json({ success: false, error: "You're banned from this group" });
        case 'ALREADY_MEMBER':
          return res.status(400).json({ success: false, error: 'You are already a member' });
        case 'PENDING_APPROVAL':
          return res.status(400).json({ success: false, error: 'Your membership request is pending approval' });
        default:
          return res.status(400).json({ success: false, error: result.error || 'Failed to join group' });
      }
    }

    const { membership: member } = result;
    const isApproved = member?.status === 'approved';

    return res.status(201).json({
      member,
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

    const { member_id, action, role } = req.body;

    if (!member_id || !action) {
      return res.status(400).json({ success: false, error: 'member_id and action required' });
    }

    // Check requester's role
    const { data: myMembership } = await getSupabase()
      .from('commander_home_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .maybeSingle();

    if (!myMembership || (myMembership.role !== 'owner' && myMembership.role !== 'admin')) {
      return res.status(403).json({ success: false, error: 'Only owners and admins can manage members' });
    }

    // Get target membership
    const { data: targetMember } = await getSupabase()
      .from('commander_home_members')
      .select('*')
      .eq('id', member_id)
      .eq('group_id', groupId)
      .maybeSingle();

    if (!targetMember) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }

    // Owners can't be modified by admins
    if (targetMember.role === 'owner' && myMembership.role !== 'owner') {
      return res.status(403).json({ success: false, error: 'Cannot modify the owner' });
    }

    let updates = {};

    switch (action) {
      case 'approve':
        updates = { status: 'approved', joined_at: new Date().toISOString() };
        break;

      case 'decline':
        updates = { status: 'declined' };
        break;

      case 'ban':
        updates = { status: 'banned' };
        break;

      case 'unban':
        updates = { status: 'approved' };
        break;

      case 'set_role':
        if (!role || !['admin', 'member'].includes(role)) {
          return res.status(400).json({ success: false, error: 'Valid role required (admin, member)' });
        }
        if (role === 'owner') {
          return res.status(400).json({ success: false, error: 'Cannot assign owner role this way' });
        }
        updates = { role };
        break;

      case 'set_can_host':
        updates = { can_host: req.body.can_host === true };
        break;

      default:
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    const { data: updated, error } = await getSupabase()
      .from('commander_home_members')
      .update(updates)
      .eq('id', member_id)
      .select(`
        *,
        profiles:user_id (id, display_name, avatar_url)
      `)
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ member: updated });
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

    const { member_id } = req.body;

    // If no member_id, user is leaving themselves
    if (!member_id) {
      const { data: myMembership } = await getSupabase()
        .from('commander_home_members')
        .select('id, role')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!myMembership) {
        return res.status(404).json({ success: false, error: 'You are not a member of this group' });
      }

      if (myMembership.role === 'owner') {
        return res.status(400).json({ success: false, error: 'Owner cannot leave. Transfer ownership or delete the group.' });
      }

      const { error } = await getSupabase()
        .from('commander_home_members')
        .delete()
        .eq('id', myMembership.id);

      if (error) throw error;

      return res.status(200).json({ success: true, message: 'You have left the group' });
    }

    // Removing another member - check permissions
    const { data: myMembership } = await getSupabase()
      .from('commander_home_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .maybeSingle();

    if (!myMembership || (myMembership.role !== 'owner' && myMembership.role !== 'admin')) {
      return res.status(403).json({ success: false, error: 'Only owners and admins can remove members' });
    }

    const { data: targetMember } = await getSupabase()
      .from('commander_home_members')
      .select('role')
      .eq('id', member_id)
      .eq('group_id', groupId)
      .maybeSingle();

    if (!targetMember) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }

    if (targetMember.role === 'owner') {
      return res.status(403).json({ success: false, error: 'Cannot remove the owner' });
    }

    const { error } = await getSupabase()
      .from('commander_home_members')
      .delete()
      .eq('id', member_id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Member removed' });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Leave/remove error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
