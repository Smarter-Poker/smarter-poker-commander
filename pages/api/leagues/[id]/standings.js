/**
 * League Standings API
 * GET /api/commander/leagues/[id]/standings
 * Per API_REFERENCE.md
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    const { id } = req.query;
    const { limit = 100 } = req.query;

    try {
      // Get standings with player info
      const { data: standings, error } = await getSupabase()
        .from('commander_league_standings')
        .select(`
          id,
          player_id,
          points,
          events_played,
          cashes,
          wins,
          earnings,
          updated_at,
          profiles (
            display_name,
            avatar_url
          )
        `)
        .eq('league_id', id)
        .order('points', { ascending: false })
        .limit(Math.min(parseInt(limit) || 50, 500));

      if (error) {
        console.warn('Standings fetch error:', error);
        throw error;
      }

      const formattedStandings = (standings || []).map(entry => ({
        player_id: entry.player_id,
        player_name: entry.profiles?.display_name || 'Player',
        avatar_url: entry.profiles?.avatar_url,
        points: entry.points || 0,
        events_played: entry.events_played || 0,
        cashes: entry.cashes || 0,
        wins: entry.wins || 0,
        earnings: entry.earnings || 0
      }));

      return res.status(200).json({
        success: true,
        data: { standings: formattedStandings }
      });

    } catch (error) {
      console.warn('Standings error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch standings' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
