/**
 * Home Game Discovery API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/discover - Find groups and players nearby
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');

      let userId = null;
      if (token) {
        const { data: authData } = await getSupabase().auth.getUser(token);
        const user = authData?.user;
        userId = user?.id;
      }

      const {
        type = 'groups', // 'groups' or 'players'
        city,
        state,
        zip_code,
        latitude,
        longitude,
        radius = 50, // miles
        game_type,
        stakes,
        limit: rawLimit = '20'
      } = req.query;
      const limit = Math.min(parseInt(rawLimit) || 20, 100);

      if (type === 'groups') {
        return discoverGroups(req, res, {
          userId,
          city,
          state,
          zip_code,
          latitude,
          longitude,
          radius,
          game_type,
          limit
        });
      }

      if (type === 'players') {
        return discoverPlayers(req, res, {
          userId,
          city,
          state,
          game_type,
          stakes,
          limit
        });
      }

      return res.status(400).json({ error: 'Invalid type. Use "groups" or "players"' });
    } catch (error) {
      console.warn('Discovery error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function discoverGroups(req, res, options) {
  const {
    userId,
    city,
    state,
    latitude,
    longitude,
    radius,
    game_type,
    limit
  } = options;

  let query = getSupabase()
    .from('commander_home_groups')
    .select(`
      id,
      name,
      description,
      is_private,
      city,
      state,
      default_game_type,
      default_stakes,
      member_count,
      frequency,
      profiles:owner_id (id, display_name, avatar_url)
    `)
    .eq('is_active', true)
    .eq('is_private', false) // Only show public groups in discovery
    .order('member_count', { ascending: false })
    .limit(parseInt(limit));

  // Location filters
  if (city) {
    query = query.ilike('city', `%${escapeIlike(city)}%`);
  }

  if (state) {
    query = query.eq('state', state);
  }

  if (game_type) {
    query = query.eq('default_game_type', game_type);
  }

  // If lat/lng provided, we'd ideally use PostGIS for distance
  // For now, filter by city/state

  const { data: groups, error } = await query;

  if (error) throw error;

  // Add user's membership status if logged in
  if (userId && groups?.length > 0) {
    const { data: memberships } = await getSupabase()
      .from('commander_home_members')
      .select('group_id, status')
      .eq('user_id', userId)
      .in('group_id', groups.map(g => g.id));

    const membershipMap = {};
    memberships?.forEach(m => {
      membershipMap[m.group_id] = m.status;
    });

    groups.forEach(group => {
      group.my_status = membershipMap[group.id] || null;
    });
  }

  return res.status(200).json({
    groups,
    filters: { city, state, game_type }
  });
}

async function discoverPlayers(req, res, options) {
  const {
    userId,
    city,
    state,
    game_type,
    stakes,
    limit
  } = options;

  if (!userId) {
    return res.status(401).json({ error: 'Login required to discover players' });
  }

  // Find players with matching preferences who are looking for games
  // This requires player_preferences from Phase 2

  let query = getSupabase()
    .from('commander_player_preferences')
    .select(`
      *,
      profiles:player_id (
        id,
        display_name,
        avatar_url,
        city,
        state
      )
    `)
    .eq('auto_join_waitlist', true)
    .neq('player_id', userId)
    .limit(parseInt(limit));

  const { data: preferences, error } = await query;

  if (error) throw error;

  // Filter by location if provided
  let players = preferences || [];

  if (city || state) {
    players = players.filter(p => {
      if (city && !p.profiles?.city?.toLowerCase().includes(city.toLowerCase())) {
        return false;
      }
      if (state && p.profiles?.state !== state) {
        return false;
      }
      return true;
    });
  }

  // Filter by game type
  if (game_type) {
    players = players.filter(p => {
      const prefs = p.preferred_games || [];
      return prefs.includes(game_type);
    });
  }

  // Filter by stakes
  if (stakes) {
    players = players.filter(p => {
      const prefs = p.preferred_stakes || [];
      return prefs.includes(stakes);
    });
  }

  // Format response
  const formattedPlayers = players.map(p => ({
    id: p.profiles?.id,
    display_name: p.profiles?.display_name,
    avatar_url: p.profiles?.avatar_url,
    city: p.profiles?.city,
    state: p.profiles?.state,
    preferred_games: p.preferred_games,
    preferred_stakes: p.preferred_stakes,
    notes: p.notes
  }));

  return res.status(200).json({
    players: formattedPlayers,
    filters: { city, state, game_type, stakes }
  });
}
