/**
 * Leagues API
 * GET /api/commander/leagues - List all leagues
 * Per API_REFERENCE.md
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method === 'POST') return createLeague(req, res);
    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'GET and POST allowed' }
      });
    }

    return listLeagues(req, res);

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listLeagues(req, res) {
  try {
    const { status, limit = 50 } = req.query;

    let query = getSupabase()
      .from('commander_leagues')
      .select(`
        id,
        name,
        description,
        organizer_id,
        venues,
        season_start,
        season_end,
        scoring_system,
        prize_pool,
        status,
        created_at
      `)
      .order('created_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 50, 500));

    if (status) {
      query = query.eq('status', status);
    }

    const { data: leagues, error } = await query;

    if (error) {
      console.warn('Leagues fetch error:', error);
      throw error;
    }

    // Get player counts for each league
    const leagueIds = (leagues || []).map(l => l.id);
    const { data: standingsCounts } = await getSupabase()
      .from('commander_league_standings')
      .select('league_id')
      .in('league_id', leagueIds.length > 0 ? leagueIds : ['none'])
          .limit(100);

    const playerCounts = {};
    (standingsCounts || []).forEach(s => {
      playerCounts[s.league_id] = (playerCounts[s.league_id] || 0) + 1;
    });

    const enrichedLeagues = (leagues || []).map(league => ({
      ...league,
      player_count: playerCounts[league.id] || 0,
      events_count: 0 // Would come from events table
    }));

    return res.status(200).json({
      success: true,
      data: { leagues: enrichedLeagues }
    });

  } catch (error) {
    console.warn('Leagues error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch leagues' }
    });
  }
}

async function createLeague(req, res) {
  const { name, description, scoring_system, season_start, season_end, prize_pool, venues, status } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'League name required' }
    });
  }

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    let organizerId = null;
    if (token) {
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      organizerId = user?.id;
    }

    const { data: league, error } = await getSupabase()
      .from('commander_leagues')
      .insert({
        name,
        description: description || null,
        organizer_id: organizerId,
        scoring_system: scoring_system || 'points',
        season_start: season_start || null,
        season_end: season_end || null,
        prize_pool: prize_pool || null,
        venues: venues || [],
        status: status || 'active'
      })
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!league) throw new Error('Failed to create league');

    return res.status(201).json({ success: true, data: { league } });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Create league error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
}
