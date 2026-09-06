/**
 * Single Home Game Group API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/groups/[id] - Get group details
 * PUT /api/commander/home-games/groups/[id] - Update group
 * DELETE /api/commander/home-games/groups/[id] - Delete group
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { getUser, guardUser } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import {
  determineGroupAccess,
  MEMBER_SELECT,
  PUBLIC_GAME_SELECT,
  PUBLIC_GROUP_SELECT,
  STAFF_GROUP_SELECT,
  toMemberDto,
  toPublicGroup,
  toStaffGroup,
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

    let { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Group ID required' });
    }

    // Resolve slug → UUID via social_pages (if not already a UUID or invite code)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const isInviteCode = !isUUID && id.length === 8 && /^[A-Z0-9]+$/i.test(id);
    if (!isUUID && !isInviteCode) {
      const { data: sp } = await getSupabase()
        .from('social_pages')
        .select('linked_entity_id')
        .eq('linked_entity_type', 'home_group')
        .eq('slug', id)
        .maybeSingle();
      if (!sp) return res.status(404).json({ success: false, error: 'Group not found' });
      id = sp.linked_entity_id;
    }

    if (req.method === 'GET') {
      return getGroup(req, res, id);
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      return updateGroup(req, res, id);
    }

    if (req.method === 'DELETE') {
      return deleteGroup(req, res, id);
    }

    res.setHeader('Allow', ['GET', 'PUT', 'PATCH', 'DELETE']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getGroup(req, res, id) {
  try {
    const userId = (await getUser(req, res))?.id || null;

    // Check if request is via invite code
    const isInviteCode = id.length === 8 && /^[A-Z0-9]+$/.test(id.toUpperCase());

    // First read only the safe boundary projection. Memberships, invite
    // credentials, exact location and settings are not read until the caller
    // has been authorized for this specific group.
    let query = getSupabase()
      .from('commander_home_groups')
      .select(PUBLIC_GROUP_SELECT);

    if (isInviteCode) {
      query = query.eq('invite_code', id.toUpperCase());
    } else {
      query = query.eq('id', id);
    }

    const { data: group, error } = await query.maybeSingle();

    if (error || !group) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    let userMembership = null;
    if (userId) {
      const { data: membership, error: membershipError } = await getSupabase()
        .from('commander_home_members')
        .select('id, user_id, role, status')
        .eq('group_id', group.id)
        .eq('user_id', userId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      userMembership = membership;
    }

    const access = determineGroupAccess({
      group,
      userId,
      membership: userMembership,
      viaInviteCode: isInviteCode,
    });
    if (!access.allowed) {
      return res.status(403).json({ success: false, error: 'This is a private group' });
    }

    if (access.isPreview) {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({
        group: toPublicGroup(group),
        is_preview: true,
      });
    }

    let responseGroup = toPublicGroup(group);
    if (access.mayReadPrivilegedGroup) {
      const { data: staffGroup, error: staffGroupError } = await getSupabase()
        .from('commander_home_groups')
        .select(STAFF_GROUP_SELECT)
        .eq('id', group.id)
        .maybeSingle();
      if (staffGroupError) throw staffGroupError;
      if (!staffGroup) {
        return res.status(404).json({ success: false, error: 'Group not found' });
      }
      responseGroup = toStaffGroup(staffGroup);
    }

    const { data: gameRows, error: gamesError } = await getSupabase()
      .from('commander_home_games')
      .select(PUBLIC_GAME_SELECT)
      .eq('group_id', group.id)
      .order('scheduled_date', { ascending: true })
      .limit(20);
    if (gamesError) throw gamesError;

    const upcomingGames = (gameRows || [])
      .filter(g => g.status !== 'cancelled' && g.status !== 'completed')
      .sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date))
      .slice(0, 5);

    let members = [];
    if (access.mayReadMembers) {
      let memberQuery = getSupabase()
        .from('commander_home_members')
        .select(MEMBER_SELECT)
        .eq('group_id', group.id)
        .limit(100);
      if (!access.isAdmin) memberQuery = memberQuery.eq('status', 'approved');
      const { data: memberRows, error: membersError } = await memberQuery;
      if (membersError) throw membersError;
      members = (memberRows || []).map(toMemberDto).filter(Boolean);
    }

    res.setHeader(
      'Cache-Control',
      userId ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=120'
    );
    return res.status(200).json({
      group: {
        ...responseGroup,
        ...(access.mayReadMembers ? { commander_home_members: members } : {}),
        commander_home_games: upcomingGames,
      },
      my_membership: userMembership || null,
      is_admin: access.isAdmin,
    });
  } catch (error) {
    console.warn('Get group error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function updateGroup(req, res, id) {
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

    // Check if user is owner or admin
    const { data: group } = await getSupabase()
      .from('commander_home_groups')
      .select('owner_id')
      .eq('id', id)
      .maybeSingle();

    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    const { data: membership } = await getSupabase()
      .from('commander_home_members')
      .select('role')
      .eq('group_id', id)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .maybeSingle();

    const canEdit = group.owner_id === user.id ||
      membership?.role === 'owner' ||
      membership?.role === 'admin';

    if (!canEdit) {
      return res.status(403).json({ success: false, error: 'Only owners and admins can update the group' });
    }

    // Explicit ALLOW-LIST instead of the prior strip-list. Prior code took the
    // full req.body, stripped a handful of fields, and wrote the rest. Any
    // admin could smuggle privileged columns in the body:
    //   • is_active                 - disable the group for everyone
    //   • last_activity_at          - bypass the 45-day inactivity auto-hide
    //   • visibility_override_until - grant self infinite discover visibility
    //   • quality_score / vitality_score - manipulate discovery ranking
    //   • promoted_to_club_id, promotion_{requested,approved}_at - fake promo
    //   • view_count, share_click_count, member_count - counter tampering
    //   • location_geog / search_vector - PostGIS / tsvector injection
    //   • promoted_to_club_id        - self-link to any arbitrary club
    //
    // Only expose the fields that hosts/admins are supposed to be able to
    // edit from the Commander group-settings UI. Unknown keys are silently
    // dropped (not rejected) so clients with cached extra fields don't fail.
    const EDITABLE = [
      'name',
      'description',
      'tagline',
      'is_private',
      'requires_approval',
      'city',
      'state',
      'zip_code',
      'latitude',
      'longitude',
      'default_game_type',
      'default_stakes',
      'typical_buyin_min',
      'typical_buyin_max',
      'max_players',
      'typical_day',
      'typical_time',
      'frequency',
      'cover_photo_url',
      'profile_photo_url',
      'tags',
      'auto_generate_games',
      'auto_generate_weeks_ahead',
      'auto_ban_after_flakes',
      'is_21_plus',
      'is_charity',
      'charity_beneficiary',
      'smoking_policy',
      'messenger_conversation_id',
      'settings',
    ];
    const body = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    for (const key of EDITABLE) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        updates[key] = body[key];
      }
    }

    const { data: updated, error } = await getSupabase()
      .from('commander_home_groups')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ success: true, group: updated });
  } catch (error) {
    console.warn('Update group error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function deleteGroup(req, res, id) {
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

    // Only owner can delete
    const { data: group } = await getSupabase()
      .from('commander_home_groups')
      .select('owner_id')
      .eq('id', id)
      .maybeSingle();

    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    if (group.owner_id !== user.id) {
      return res.status(403).json({ success: false, error: 'Only the owner can delete this group' });
    }

    const { error } = await getSupabase()
      .from('commander_home_groups')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Group deleted' });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Delete group error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
