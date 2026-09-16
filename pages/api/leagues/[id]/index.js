/**
 * League Detail API
 * GET /api/commander/leagues/[id] - Get league details
 * Per API_REFERENCE.md
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';

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
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    const { id } = req.query;

    try {
      // Get league details
      const { data: league, error: leagueError } = await getSupabase()
        .from('commander_leagues')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (leagueError || !league) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'League not found' }
        });
      }

      // Get player count
      const { count: playerCount } = await getSupabase()
        .from('commander_league_standings')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', id)
            .limit(100);

      // Check if current user is joined (if authenticated)
      let isJoined = false;
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const { data: authData } = await getSupabase().auth.getUser(token);
        const user = authData?.user;
        if (user) {
          const { data: membership } = await getSupabase()
            .from('commander_league_standings')
            .select('id')
            .eq('league_id', id)
            .eq('player_id', user.id)
            .maybeSingle();
          isJoined = !!membership;
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          league: {
            ...league,
            player_count: playerCount || 0
          },
          events: [], // Would come from events table
          is_joined: isJoined
        }
      });

    } catch (error) {
      console.warn('League detail error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch league' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
