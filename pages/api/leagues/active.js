/**
 * Public league list - GET /api/commander/leagues/active[?venue_id=]
 *
 * The player-facing view of leagues, used by smarter.poker/hub/commander/leagues
 * (linked from the Commander menu and the sitemap). /api/commander/leagues is
 * staff-only since the 2026-08-20 audit, so that page answered 401 "Staff
 * Authentication Required" to every player, signed in or not.
 *
 * This route follows the pattern of /api/commander/promotions/active: no auth,
 * read-only, and only the columns a player is meant to see - name, season,
 * scoring, prize pool, status and how many players are in it. It does NOT
 * return organizer_id or anything from the staff listing beyond that.
 * Standings (player names and lifetime earnings) stay staff-only.
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

export const PUBLIC_LEAGUE_STATUSES = ['active', 'upcoming', 'completed'];
export const PUBLIC_LEAGUE_COLUMNS =
  'id, name, description, venue_id, venues, season, season_start, season_end, start_date, end_date, scoring_system, prize_pool, status, created_at';

export function leagueInVenue(league, venueId) {
  if (venueId === undefined || venueId === null || venueId === '') return true;
  const want = String(venueId);
  if (league.venue_id !== undefined && league.venue_id !== null && String(league.venue_id) === want) return true;
  return Array.isArray(league.venues) && league.venues.some((v) => String(v) === want);
}

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
    }

    const venueId = typeof req.query.venue_id === 'string' ? req.query.venue_id : null;
    if (venueId !== null && !/^\d{1,12}$/.test(venueId)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_VENUE', message: 'venue_id must be a number' } });
    }

    const { data, error } = await getSupabase()
      .from('commander_leagues')
      .select(PUBLIC_LEAGUE_COLUMNS)
      .in('status', PUBLIC_LEAGUE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.warn('[leagues/active] fetch failed:', error.message);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch leagues' } });
    }

    const leagues = (data || []).filter((l) => leagueInVenue(l, venueId));

    const counted = await Promise.all(leagues.map(async (league) => {
      const { count } = await getSupabase()
        .from('commander_league_standings')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', league.id);
      return { ...league, player_count: count || 0 };
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ success: true, data: { leagues: counted } });
  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
