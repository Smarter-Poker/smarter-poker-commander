/**
 * Tournament Leaderboards API
 * GET /api/commander/tournaments/leaderboards - List leaderboards for venue
 * POST /api/commander/tournaments/leaderboards - Create new leaderboard
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      const _g = await guardWriteStaff(req, res); if (!_g) return;

      if (req.method === 'GET') return listLeaderboards(req, res);
      if (req.method === 'POST') return createLeaderboard(req, res, _g);

      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listLeaderboards(req, res) {
    try {
        const { venue_id, active_only } = req.query;
        if (!venue_id) return res.status(400).json({ success: false, error: { message: 'venue_id required' } });

        let query = getSupabase()
            .from('commander_tournament_leaderboards')
            .select('*')
            .eq('venue_id', venue_id)
            .order('season_start', { ascending: false })
                .limit(100);

        if (active_only === 'true') {
            query = query.eq('is_active', true)
                .limit(100);
        }

        const { data, error } = await query;
        if (error) throw error;

        // For each leaderboard, get top standings
        const leaderboardsWithStandings = await Promise.all((data || []).map(async (lb) => {
            const { data: points } = await getSupabase()
                .from('commander_tournament_points')
                .select('player_id, player_name, points, finish_position, entry_points')
                .eq('leaderboard_id', lb.id)
                    .limit(100);

            // Aggregate points per player
            const playerMap = {};
            (points || []).forEach(p => {
                const key = p.player_id || p.player_name;
                if (!playerMap[key]) {
                    playerMap[key] = { player_id: p.player_id, player_name: p.player_name, total_points: 0, events_played: 0, best_finish: null };
                }
                playerMap[key].total_points += (p.points || 0) + (p.entry_points || 0);
                playerMap[key].events_played += 1;
                if (p.finish_position && (!playerMap[key].best_finish || p.finish_position < playerMap[key].best_finish)) {
                    playerMap[key].best_finish = p.finish_position;
                }
            });

            const standings = Object.values(playerMap || {})
                .sort((a, b) => b.total_points - a.total_points)
                .map((player, index) => ({ ...player, rank: index + 1 }));

            return { ...lb, standings };
        }));

        return res.status(200).json({ success: true, data: { leaderboards: leaderboardsWithStandings } });
    } catch (error) {
        console.warn('List leaderboards error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}

async function createLeaderboard(req, res, staff) {
    try {
        if (!staff || staff === true) {
            return res.status(401).json({ success: false, error: { message: 'Staff auth required' } });
        }

        const { venue_id, name, season_start, season_end, point_for_entry, point_structure } = req.body;

        if (!venue_id || !name || !season_start || !season_end) {
            return res.status(400).json({ success: false, error: { message: 'venue_id, name, season_start, season_end required' } });
        }

        const { data, error } = await getSupabase()
            .from('commander_tournament_leaderboards')
            .insert({
                venue_id,
                name,
                season_start,
                season_end,
                point_for_entry: point_for_entry || 1,
                point_structure: point_structure || [
                    { position: 1, points: 100 },
                    { position: 2, points: 75 },
                    { position: 3, points: 60 },
                    { position: 4, points: 50 },
                    { position: 5, points: 40 },
                    { position: 6, points: 35 },
                    { position: 7, points: 30 },
                    { position: 8, points: 25 },
                    { position: 9, points: 20 },
                    { position: 10, points: 15 }
                ]
            })
            .select()
            .maybeSingle();

        if (error) throw error;

        return res.status(201).json({ success: true, data: { leaderboard: data } });
    } catch (error) {
        try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
        console.warn('Create leaderboard error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}
