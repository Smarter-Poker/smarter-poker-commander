/**
 * Current Session API
 * GET /api/commander/sessions/current - Get player's active session
 * Returns the player's current seat location if they are seated at a game
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
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' }
      });
    }

    try {
      // Find player's current seat (where they are actively seated in a running game)
      const { data: seats, error } = await getSupabase()
        .from('commander_seats')
        .select(`
          id,
          seat_number,
          seated_at,
          game_id,
          commander_games (
            id,
            venue_id,
            game_type,
            stakes,
            status,
            table_id
          )
        `)
        .eq('player_id', user.id)
        .eq('status', 'occupied')
        .order('seated_at', { ascending: false });

      if (error) {
        throw error;
      }

      // Filter for active games
      const activeSeat = seats?.find(s =>
        s.commander_games && ['waiting', 'running'].includes(s.commander_games.status)
      );

      if (!activeSeat) {
        return res.status(200).json({
          success: true,
          data: { session: null }
        });
      }

      // Get table info
      let tableInfo = null;
      if (activeSeat.commander_games.table_id) {
        const { data: table } = await getSupabase()
          .from('commander_tables')
          .select('id, table_number, table_name')
          .eq('id', activeSeat.commander_games.table_id)
          .maybeSingle();
        tableInfo = table;
      }

      // Get venue info
      const { data: venue } = await getSupabase()
        .from('poker_venues')
        .select('id, name')
        .eq('id', activeSeat.commander_games.venue_id)
        .maybeSingle();

      // Format response
      const formattedSession = {
        id: activeSeat.id,
        venue_id: activeSeat.commander_games.venue_id,
        venue_name: venue?.name || 'Unknown Venue',
        game_id: activeSeat.commander_games.id,
        game_type: activeSeat.commander_games.game_type,
        stakes: activeSeat.commander_games.stakes,
        table_id: tableInfo?.id,
        table_number: tableInfo?.table_number,
        seat_number: activeSeat.seat_number,
        check_in_time: activeSeat.seated_at
      };

      return res.status(200).json({
        success: true,
        data: { session: formattedSession }
      });
    } catch (error) {
      console.warn('Get current session error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to get current session' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
