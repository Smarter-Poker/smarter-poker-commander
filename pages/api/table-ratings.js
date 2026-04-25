/**
 * Table Atmosphere Ratings API
 * POST /api/commander/table-ratings — Submit a rating after session
 * GET /api/commander/table-ratings — Get aggregated vibes for venue tables
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method === 'POST') return submitRating(req, res);
    if (req.method === 'GET') return getVibes(req, res);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function submitRating(req, res) {
  const { venue_id, table_number, action_level, friendliness, pace, game_type, stakes, comment, player_id, session_id } = req.body;

  if (!venue_id || !table_number || !action_level || !friendliness || !pace) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id, table_number, action_level, friendliness, pace required' } });
  }

  // Validate ranges
  for (const [name, val] of [['action_level', action_level], ['friendliness', friendliness], ['pace', pace]]) {
    if (val < 1 || val > 5) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_RANGE', message: `${name} must be 1-5` } });
    }
  }

  try {
    let userId = player_id || null;
    const authHeader = req.headers.authorization;
    if (authHeader && !userId) {
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      userId = user?.id || null;
    }

    const { data: rating, error } = await getSupabase()
      .from('commander_table_ratings')
      .insert({
        venue_id,
        table_number: parseInt(table_number),
        player_id: userId,
        session_id: session_id || null,
        action_level: parseInt(action_level),
        friendliness: parseInt(friendliness),
        pace: parseInt(pace),
        game_type: game_type || null,
        stakes: stakes || null,
        comment: comment?.trim() || null
      })
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!rating) throw new Error('Failed to save rating');

    return res.status(201).json({ success: true, data: { rating } });
  } catch (error) {
    console.warn('Submit rating error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}

async function getVibes(req, res) {
  const { venue_id, days = 30 } = req.query;

  if (!venue_id) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id required' } });
  }

  // Table ratings are aggregates — safe to cache 30s at the CDN edge
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');

  try {
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    const { data: ratings, error } = await getSupabase()
      .from('commander_table_ratings')
      .select('table_number, action_level, friendliness, pace, game_type, stakes, comment, created_at')
      .eq('venue_id', venue_id)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Aggregate by table
    const tableMap = {};
    (ratings || []).forEach(r => {
      const key = r.table_number;
      if (!tableMap[key]) {
        tableMap[key] = { table_number: key, ratings: [], totalAction: 0, totalFriendly: 0, totalPace: 0, count: 0, recentComments: [] };
      }
      tableMap[key].totalAction += r.action_level;
      tableMap[key].totalFriendly += r.friendliness;
      tableMap[key].totalPace += r.pace;
      tableMap[key].count += 1;
      if (r.comment && tableMap[key].recentComments.length < 3) {
        tableMap[key].recentComments.push(r.comment);
      }
    });

    // Calculate vibes
    const vibes = Object.values(tableMap || {}).map(t => {
      const avgAction = t.count > 0 ? t.totalAction / t.count : 3;
      const avgFriendly = t.count > 0 ? t.totalFriendly / t.count : 3;
      const avgPace = t.count > 0 ? t.totalPace / t.count : 3;

      // Determine vibe label
      let vibe = 'Standard Game';
      if (avgAction >= 4 && avgFriendly >= 3.5) vibe = 'Action Game';
      else if (avgFriendly >= 4) vibe = 'Social Game';
      else if (avgAction <= 2 && avgFriendly <= 2.5) vibe = 'Grinder Table';
      else if (avgPace >= 4) vibe = 'Fast Game';
      else if (avgPace <= 2) vibe = 'Relaxed Pace';
      else if (avgAction >= 3.5) vibe = 'Aggressive Game';

      return {
        table_number: t.table_number,
        avg_action: Math.round(avgAction * 10) / 10,
        avg_friendliness: Math.round(avgFriendly * 10) / 10,
        avg_pace: Math.round(avgPace * 10) / 10,
        vibe,
        rating_count: t.count,
        recent_comments: t.recentComments
      };
    });

    vibes.sort((a, b) => a.table_number - b.table_number);

    return res.status(200).json({
      success: true,
      data: { vibes, total_ratings: (ratings || []).length, period_days: parseInt(days) }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Get vibes error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}
