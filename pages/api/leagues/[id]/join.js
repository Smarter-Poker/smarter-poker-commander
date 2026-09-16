/**
 * Join League API
 * POST /api/commander/leagues/[id]/join
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

// Auth: USER - players join leagues with their own Bearer JWT
// 2026-07-25 audit fix: removed the guardOwnerStaff gate - it required an
// owner/manager staff session, so no player could ever join a league. The
// handler body below already authenticates the Bearer user and joins them
// as themselves (identity from the verified token, never the body).
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { id } = req.query;

    // Require authentication
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
      });
    }

    try {
      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Invalid token' }
        });
      }

      // Check if league exists
      const { data: league, error: leagueError } = await getSupabase()
        .from('commander_leagues')
        .select('id, status')
        .eq('id', id)
        .maybeSingle();

      if (leagueError || !league) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'League not found' }
        });
      }

      // Check if already joined
      const { data: existing } = await getSupabase()
        .from('commander_league_standings')
        .select('id')
        .eq('league_id', id)
        .eq('player_id', user.id)
        .maybeSingle();

      if (existing) {
        return res.status(400).json({
          success: false,
          error: { code: 'ALREADY_JOINED', message: 'Already a member of this league' }
        });
      }

      // Join the league
      const { data: standing, error: joinError } = await getSupabase()
        .from('commander_league_standings')
        .insert({
          league_id: id,
          player_id: user.id,
          points: 0,
          events_played: 0,
          cashes: 0,
          wins: 0,
          earnings: 0
        })
        .select()
        .maybeSingle();

      if (joinError) {
        console.warn('Join error:', joinError);
        throw joinError;
      }

      return res.status(200).json({
        success: true,
        data: { standing }
      });

    } catch (error) {
      console.warn('Join league error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to join league' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
