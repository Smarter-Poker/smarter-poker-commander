/**
 * Leagues API
 * GET /api/commander/leagues - List all leagues
 * Per API_REFERENCE.md
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

    // 2026-08-20 audit fix: was guardWriteStaff, which returns `true` for GET
    // without verifying anything - the league list (organizer ids, member
    // venues, prize pools) was public.
    const _g = await guardStaff(req, res); if (!_g) return;

    if (req.method === 'POST') return createLeague(req, res, _g);
    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'GET and POST allowed' }
      });
    }

    return listLeagues(req, res, _g);

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// A league is in scope for a venue when it is stamped with that venue_id or
// lists it in the cross-venue `venues` array. Both are checked because the
// live rows carry only `venues` (venue_id is null on every existing row) while
// createLeague below now writes both.
export function leagueBelongsToVenue(league, venueId) {
  if (venueId === undefined || venueId === null) return true;
  const want = String(venueId);
  if (league.venue_id !== undefined && league.venue_id !== null
      && String(league.venue_id) === want) return true;
  return Array.isArray(league.venues) && league.venues.some(v => String(v) === want);
}

async function listLeagues(req, res, staff) {
  try {
    const { status, limit = 50 } = req.query;
    const staffVenueId = (staff && staff !== true && staff.venue_id !== undefined && staff.venue_id !== null)
      ? staff.venue_id
      : null;

    let query = getSupabase()
      .from('commander_leagues')
      .select(`
        id,
        name,
        description,
        organizer_id,
        venue_id,
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

    const { data: allLeagues, error } = await query;

    if (error) {
      console.warn('Leagues fetch error:', error);
      throw error;
    }

    // 2026-08-20 audit fix: the list was unscoped, so every venue's staff saw
    // every other venue's leagues (names, organizer ids, prize pools). Leagues
    // ARE cross-venue by design, so the filter is membership-based rather than
    // a flat venue_id equality.
    const leagues = (allLeagues || []).filter(l => leagueBelongsToVenue(l, staffVenueId));

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

async function createLeague(req, res, staff) {
  const { name, description, scoring_system, season_start, season_end, prize_pool, venues, status } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'League name required' }
    });
  }

  // 2026-08-20 audit fix: createLeague had no venue scoping at all - the new
  // row was stamped with whatever `venues` array the body carried (or none),
  // so a league could be created into another venue's list, or into nobody's.
  // The caller's own venue is always stamped on the row and always present in
  // the membership array; extra venues are still allowed (leagues are
  // cross-venue by design) but the creator's venue can never be dropped.
  const staffVenueId = (staff && staff !== true && staff.venue_id !== undefined && staff.venue_id !== null)
    ? staff.venue_id
    : null;

  const requestedVenues = Array.isArray(venues) ? venues : [];
  const venueList = staffVenueId === null
    ? requestedVenues
    : (requestedVenues.some(v => String(v) === String(staffVenueId))
      ? requestedVenues
      : [staffVenueId, ...requestedVenues]);

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
        venue_id: staffVenueId,
        scoring_system: scoring_system || 'points',
        season_start: season_start || null,
        season_end: season_end || null,
        prize_pool: prize_pool || null,
        venues: venueList,
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
