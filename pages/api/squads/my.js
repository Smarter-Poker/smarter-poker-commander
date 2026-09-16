/**
 * My Squads API
 * GET /api/commander/squads/my - Get player's squads and invitations
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' }
      });
    }

    try {
      const { status } = req.query;

      // Get waitlist groups where user is a member
      // Note: no FK constraint exists from group_members→groups, so we use two queries
      const { data: memberships, error } = await getSupabase()
        .from('commander_waitlist_group_members')
        .select('id, player_id, group_id, joined_at')
        .eq('player_id', user.id)
        .order('joined_at', { ascending: false })
            .limit(100);

      if (error) throw error;

      // Fetch group details for each membership
      // 2026-07-25 audit fix: removed stray .limit(100) chained onto a JS array
      // (arrays have no .limit - it crashed the endpoint).
      const groupIds = [...new Set((memberships || []).map(m => m.group_id).filter(Boolean))];

      let groupsMap = {};
      if (groupIds.length > 0) {
        // 2026-07-25 audit fix: real column is group_status (aliased to status);
        // prefer_same_table/accept_split do not exist on this table.
        const { data: groups } = await getSupabase()
          .from('commander_waitlist_groups')
          .select('id, game_type, stakes, status:group_status, created_at, venue_id, leader_id')
          .in('id', groupIds)
              .limit(100);

        // 2026-07-29 wiring fix: commander_waitlist_groups has no FK to
        // poker_venues or profiles, so the venue and leader cannot be
        // PostgREST-embedded off the group (errors PGRST200). Fetch them via
        // separate keyed queries and attach as poker_venues/profiles.
        const venueIds = [...new Set((groups || []).map(g => g.venue_id).filter(Boolean))];
        const leaderIds = [...new Set((groups || []).map(g => g.leader_id).filter(Boolean))];
        const venuesMap = {};
        const leadersMap = {};
        if (venueIds.length > 0) {
          const { data: venues } = await getSupabase()
            .from('poker_venues')
            .select('id, name, city, state')
            .in('id', venueIds);
          (venues || []).forEach(v => { venuesMap[v.id] = v; });
        }
        if (leaderIds.length > 0) {
          const { data: leaders } = await getSupabase()
            .from('profiles')
            .select('id, display_name, avatar_url')
            .in('id', leaderIds);
          (leaders || []).forEach(l => { leadersMap[l.id] = l; });
        }
        (groups || []).forEach(g => {
          g.poker_venues = venuesMap[g.venue_id] || null;
          g.profiles = leadersMap[g.leader_id] || null;
          groupsMap[g.id] = g;
        });
      }

      // Separate active squads and completed ones
      const activeSquads = [];
      const completedSquads = [];

      memberships?.forEach(m => {
        const g = groupsMap[m.group_id];
        if (!g) return;

        const squad = {
          id: g.id,
          game_type: g.game_type,
          stakes: g.stakes,
          squad_status: g.status,
          prefer_same_table: g.prefer_same_table,
          accept_split: g.accept_split,
          venue: g.poker_venues,
          leader: g.profiles,
          joined_at: m.joined_at
        };

        if (g.status === 'waiting') {
          activeSquads.push(squad);
        } else {
          completedSquads.push(squad);
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          squads: activeSquads,
          completed: completedSquads,
          total: memberships?.length || 0
        }
      });
    } catch (error) {
      console.warn('Get my squads error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to get squads' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
