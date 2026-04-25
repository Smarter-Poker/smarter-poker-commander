/**
 * Player Hand History Sessions API
 * GET /api/commander/hands/sessions
 * Returns sessions where player has hand history
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
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

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

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

      // Get games where player participated and has hand history
      const { data: sessions, error } = await getSupabase()
        .from('commander_games')
        .select(`
          id,
          table_id,
          game_type,
          stakes,
          started_at,
          ended_at,
          commander_tables!commander_games_table_id_fkey!inner(
            id,
            table_number,
            venue_id,
            poker_venues(id, name)
          )
        `)
        .eq('status', 'closed')
        .order('started_at', { ascending: false })
        .limit(20);

      if (error) {
        console.warn('Sessions error:', error);
        throw error;
      }

      // Get hand counts for each game
      const gameIds = sessions?.map(s => s.id) || [];

      const { data: handCounts } = await getSupabase()
        .from('commander_hand_history')
        .select('game_id')
        .in('game_id', gameIds)
            .limit(100);

      const countMap = {};
      handCounts?.forEach(h => {
        countMap[h.game_id] = (countMap[h.game_id] || 0) + 1;
      });

      // Format response
      const formattedSessions = sessions
        ?.filter(s => countMap[s.id] > 0)
        .map(session => {
          const duration = session.ended_at && session.started_at
            ? Math.round((new Date(session.ended_at) - new Date(session.started_at)) / 3600000)
            : 0;

          return {
            id: session.id,
            game_id: session.id,
            venue_name: session.commander_tables?.poker_venues?.name || 'Unknown Venue',
            game_type: `${session.stakes || ''} ${session.game_type || 'NLH'}`.trim(),
            hands_played: countMap[session.id] || 0,
            profit: 0, // Would need session tracking for actual profit
            duration_hours: duration,
            date: session.started_at
          };
        }) || [];

      return res.status(200).json({
        success: true,
        data: { sessions: formattedSessions }
      });

    } catch (error) {
      console.warn('Sessions API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch sessions' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
