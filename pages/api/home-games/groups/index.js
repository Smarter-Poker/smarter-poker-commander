/**
 * Home Game Groups API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/groups - List groups
 * POST /api/commander/home-games/groups - Create group
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { getUser, guardUser } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';
import {
  PUBLIC_GROUP_SELECT,
  toPublicGroup,
  STAFF_GROUP_SELECT,
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
/** Escape SQL LIKE wildcards */
function escapeIlike(s) { return (s || '').replace(/[%_\\]/g, c => '\\' + c); }

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (!applyRateLimit(req, res, LIMITS.read)) return;
    } else if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'GET') { const _u = await guardUser(req, res); if (!_u) return; }

    if (req.method === 'GET') {
      return listGroups(req, res);
    }

    if (req.method === 'POST') {
      return createGroup(req, res);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listGroups(req, res) {
  try {
    const userId = (await getUser(req, res))?.id || null;

    const safeP = (v) => Array.isArray(v) ? v[0] : (v || '');
    const my_groups = safeP(req.query.my_groups);
    const city = safeP(req.query.city);
    const state = safeP(req.query.state);
    const game_type = safeP(req.query.game_type);
    let callerMemberships = [];

    let query = getSupabase()
      .from('commander_home_groups')
      .select(PUBLIC_GROUP_SELECT)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(100);

    // Filter to user's groups
    if (my_groups === 'true') {
      if (!userId) {
        return res.status(401).json({ error: 'Authorization required' });
      }

      const { data: memberships, error: membershipError } = await getSupabase()
        .from('commander_home_members')
        .select('group_id, role, status')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .limit(100);

      if (membershipError) throw membershipError;
      callerMemberships = memberships || [];

      const groupIds = callerMemberships.map(m => m.group_id).filter(Boolean);
      if (groupIds.length > 0) {
        query = query.or(`owner_id.eq.${userId},id.in.(${groupIds.join(',')})`);
      } else {
        query = query.eq('owner_id', userId);
      }
    } else {
      // The general directory is public-only, even for an authenticated user.
      query = query.eq('is_private', false);
    }

    if (city) {
      query = query.ilike('city', `%${escapeIlike(city)}%`);
    }

    if (state) {
      query = query.eq('state', state);
    }

    if (game_type) {
      query = query.eq('default_game_type', game_type);
    }

    const { data, error } = await query.limit(50);

    if (error) throw error;

    // Attach only the caller's own membership. Other member identities never
    // cross the list endpoint.
    if (userId && data?.length > 0) {
      if (my_groups !== 'true') {
        const { data: memberships, error: membershipError } = await getSupabase()
          .from('commander_home_members')
          .select('group_id, role, status')
          .eq('user_id', userId)
          .in('group_id', data.map(g => g.id));
        if (membershipError) throw membershipError;
        callerMemberships = memberships || [];
      }

      const membershipMap = {};
      callerMemberships.forEach(m => {
        membershipMap[m.group_id] = m;
      });
      return res.status(200).json({
        groups: data.map(group => toPublicGroup(group, membershipMap[group.id] || null)),
      });
    }

    return res.status(200).json({ groups: (data || []).map(group => toPublicGroup(group)) });
  } catch (error) {
    console.warn('List groups error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createGroup(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const {
      name,
      description,
      is_private,
      requires_approval,
      city,
      state,
      zip_code,
      latitude,
      longitude,
      default_game_type,
      default_stakes,
      typical_buyin_min,
      typical_buyin_max,
      max_players,
      typical_day,
      typical_time,
      frequency,
      settings,
      // ── PHASE 17 - HARD LOGO REQUIREMENT ────────────────────────────
      // Client uploads the logo through /api/social/upload (the same
      // endpoint Club Commander and Social Pages use for avatar/logo
      // uploads) and sends us the returned public URL here. We don't
      // re-validate the URL shape - /api/social/upload already
      // authenticates the user, validates file type/size, and writes
      // through the service role to the social-media bucket. Our job
      // is just to enforce that we received SOME url.
      profile_photo_url
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    // ── LOGO HARD REQUIREMENT ───────────────────────────────────────
    if (!profile_photo_url || typeof profile_photo_url !== 'string' || !profile_photo_url.trim()) {
      return res.status(400).json({
        error: 'Logo upload is required to create a home group',
        code: 'LOGO_REQUIRED'
      });
    }

    const { data: group, error } = await getSupabase()
      .from('commander_home_groups')
      .insert({
        name,
        description,
        owner_id: user.id,
        is_private: is_private !== false,
        requires_approval: requires_approval !== false,
        city,
        state,
        zip_code,
        latitude,
        longitude,
        default_game_type: default_game_type || 'nlhe',
        default_stakes,
        typical_buyin_min,
        typical_buyin_max,
        max_players: max_players || 9,
        typical_day,
        typical_time,
        frequency,
        profile_photo_url,   // Phase 17: required, validated above
        settings: settings || {}
      })
      .select(STAFF_GROUP_SELECT)
      .maybeSingle();

    if (error) throw error;
    const responseGroup = toStaffGroup(group);

    // Fetch the social_pages row the autocreate trigger just created.
    // Relationship is reverse - social_pages.linked_entity_type='home_group'
    // + social_pages.linked_entity_id=group.id::text (linked_entity_id is TEXT).
    // We don't INSERT the page here; the database trigger
    // trg_autocreate_home_group_social_page owns that path as of the
    // home-games unification work. Historical code had a second manual
    // insert here with category='home-game' that silently failed due to
    // the page_type NOT NULL constraint - that has been removed.
    try {
      const { data: socialPage } = await getSupabase()
        .from('social_pages')
        .select('id, slug, name, description, avatar_url, cover_url, location_city, location_state, metadata')
        .eq('linked_entity_type', 'home_group')
        .eq('linked_entity_id', String(group.id))
        .maybeSingle();

      if (socialPage) {
        responseGroup.social_page = socialPage;
      }
    } catch (fetchSocialPageErr) {
      console.warn('Failed to fetch auto-created social page:', fetchSocialPageErr);
      // Non-fatal - group creation succeeded; caller can discover the
      // social page on next load via the same linked_entity lookup.
    }

    return res.status(201).json({ group: responseGroup });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Create group error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
