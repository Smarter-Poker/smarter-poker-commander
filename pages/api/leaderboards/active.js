/**
 * Public venue leaderboards - GET /api/commander/leaderboards/active?venue_id=
 *
 * The player-facing view used by smarter.poker/hub/commander/leaderboard/[venueId].
 * /api/commander/leaderboards and /api/commander/leaderboards/:id are staff-only
 * since the 2026-08-20 audit (they return every column, settings included), so
 * that page answered 401 "Staff Authentication Required" to every player.
 *
 * Like /api/commander/promotions/active this is no-auth and read-only, scoped to
 * one venue, active boards only, and returns display columns: the board's name,
 * type, period, dates, prizes and rules, plus each board's top entries as rank,
 * score, hours, sessions, points, prize won, display name and avatar. It does
 * NOT return the board's internal `settings`, the entry's player_id, or whether
 * a prize was paid.
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

export const PUBLIC_BOARD_COLUMNS =
  'id, venue_id, name, description, leaderboard_type, period_type, start_date, end_date, prizes, min_hours, min_sessions, eligible_games, rules_description, status';
export const PUBLIC_ENTRY_COLUMNS =
  'id, rank, score, hours_played, sessions_count, points_earned, prize_position, prize_won, profiles:player_id (display_name, avatar_url)';
const ENTRIES_PER_BOARD = 50;

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
    }

    const venueId = typeof req.query.venue_id === 'string' ? req.query.venue_id : '';
    if (!/^\d{1,12}$/.test(venueId)) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id required' } });
    }

    const { data: boards, error } = await getSupabase()
      .from('commander_leaderboards')
      .select(PUBLIC_BOARD_COLUMNS)
      .eq('venue_id', venueId)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(10);

    if (error) {
      console.warn('[leaderboards/active] fetch failed:', error.message);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch leaderboards' } });
    }

    const withEntries = await Promise.all((boards || []).map(async (board) => {
      const { data: entries, error: entriesError } = await getSupabase()
        .from('commander_leaderboard_entries')
        .select(PUBLIC_ENTRY_COLUMNS)
        .eq('leaderboard_id', board.id)
        .order('rank', { ascending: true, nullsFirst: false })
        .order('score', { ascending: false })
        .limit(ENTRIES_PER_BOARD);
      if (entriesError) console.warn('[leaderboards/active] entries failed:', board.id, entriesError.message);
      return { ...board, entries: entries || [] };
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ success: true, data: { leaderboards: withEntries } });
  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
