/**
 * Single Home Game Group API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/groups/[id] - Get group details
 * PUT /api/commander/home-games/groups/[id] - Update group
 * DELETE /api/commander/home-games/groups/[id] - Delete group
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
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    let userId = null;
    if (token) {
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      userId = user?.id;
    }

    // Check if request is via invite code
    const isInviteCode = id.length === 8 && /^[A-Z0-9]+$/.test(id.toUpperCase());

    let query = getSupabase()
      .from('commander_home_groups')
      .select(`
        *,
        profiles:owner_id (id, display_name, avatar_url),
        commander_home_members (
          id, user_id, role, status, games_attended,
          profiles:user_id (id, display_name, avatar_url)
        ),
        commander_home_games (
          id, title, scheduled_date, start_time, status, rsvp_yes, max_players
        )
      `);

    if (isInviteCode) {
      query = query.eq('invite_code', id.toUpperCase());
    } else {
      query = query.eq('id', id);
    }

    const { data: group, error } = await query.maybeSingle();

    if (error || !group) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }

    // Check access for private groups
    if (group.is_private && userId !== group.owner_id) {
      const isMember = group.commander_home_members?.some(
        m => m.user_id === userId && m.status === 'approved'
      );

      if (!isMember && !isInviteCode) {
        return res.status(403).json({ success: false, error: 'This is a private group' });
      }

      // For invite code access, only show limited info
      if (isInviteCode && !isMember) {
        return res.status(200).json({
          group: {
            id: group.id,
            name: group.name,
            description: group.description,
            member_count: group.member_count,
            default_game_type: group.default_game_type,
            city: group.city,
            state: group.state,
            invite_code: group.invite_code
          },
          is_preview: true
        });
      }
    }

    // Filter members to only approved for non-admins. IMPORTANT: we ALSO
    // require the viewing user's membership to be status='approved' - a
    // member whose role is 'admin' but whose status is 'pending', 'banned',
    // or 'declined' should NOT see the full (including pending/banned)
    // member list. Prior code checked role only and leaked.
    let members = group.commander_home_members || [];
    const userMembership = members.find(m => m.user_id === userId);
    const isAdmin =
      userMembership?.status === 'approved' &&
      (userMembership?.role === 'owner' || userMembership?.role === 'admin');

    if (!isAdmin) {
      members = members.filter(m => m.status === 'approved');
    }

    // DEFENSIVE: Ensure all member profiles have required fields
    members = members.map(m => ({
      ...m,
      profiles: m.profiles || { id: m.user_id, display_name: 'Unknown Member', avatar_url: null }
    }));

    // DEFENSIVE: Ensure owner profile exists
    if (!group.profiles) {
      group.profiles = { id: group.owner_id, display_name: 'Unknown Host', avatar_url: null };
    }

    // Filter upcoming games
    const upcomingGames = (group.commander_home_games || [])
      .filter(g => g.status !== 'cancelled' && g.status !== 'completed')
      .sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date))
      .slice(0, 5);

    return res.status(200).json({
      group: {
        ...group,
        commander_home_members: members,
        commander_home_games: upcomingGames
      },
      my_membership: userMembership || null,
      is_admin: isAdmin
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
