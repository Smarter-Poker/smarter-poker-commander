/**
 * Venue Analytics API - GET /api/commander/venues/[id]/analytics
 * Returns analytics summary for a venue
 * Reference: API_REFERENCE.md - Analytics section
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { requireStaff } from '../../../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    const { id: venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Venue ID required' }
      });
    }

    // Require staff auth
    const staff = await requireStaff(req, res, venueId);
    if (!staff) return;

    try {
      const { period = 'today' } = req.query;
      const now = new Date();
      let dateFrom;

      switch (period) {
        case 'today':
          dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
          break;
        case 'week':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
          break;
        case 'month':
          dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
          break;
        default:
          dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      }

      // Fetch data in parallel
      const [
        tablesResult,
        gamesResult,
        waitlistResult,
        sessionsResult,
        tournamentsResult,
        analyticsResult
      ] = await Promise.all([
        // Active tables
        getSupabase()
          .from('commander_tables')
          .select('id, status')
          .eq('venue_id', venueId),

        // Running games
        getSupabase()
          .from('commander_games')
          .select('id, game_type, stakes, status, player_count, max_players')
          .eq('venue_id', venueId)
          .in('status', ['waiting', 'running']),

        // Current waitlist
        getSupabase()
          .from('commander_waitlist')
          .select('id, game_type, stakes, status')
          .eq('venue_id', venueId)
          .eq('status', 'waiting'),

        // Sessions in period
        getSupabase()
          .from('commander_player_sessions')
          .select('id, status, check_in_at, total_time_minutes')
          .eq('venue_id', venueId)
          .gte('check_in_at', dateFrom),

        // Tournaments in period
        getSupabase()
          .from('commander_tournaments')
          .select('id, status, current_entries, buyin_amount')
          .eq('venue_id', venueId)
          .gte('scheduled_start', dateFrom),

        // Daily analytics records
        getSupabase()
          .from('commander_analytics_daily')
          .select('*')
          .eq('venue_id', venueId)
          .gte('date', dateFrom.split('T')[0])
          .order('date', { ascending: false })
          .limit(30)
      ]);

      const tables = tablesResult.data || [];
      const games = gamesResult.data || [];
      const waitlist = waitlistResult.data || [];
      const sessions = sessionsResult.data || [];
      const tournaments = tournamentsResult.data || [];
      const dailyAnalytics = analyticsResult.data || [];

      // Compute summary
      const activeTables = tables.filter(t => t.status === 'active').length;
      const totalTables = tables.length;
      const runningGames = games.filter(g => g.status === 'running').length;
      const totalSeated = games.reduce((sum, g) => sum + (g.player_count || 0), 0);
      const totalCapacity = games.reduce((sum, g) => sum + (g.max_players || 0), 0);
      const waitingPlayers = waitlist.length;
      const totalSessions = sessions.length;
      const activeSessions = sessions.filter(s => s.status === 'active').length;
      const avgSessionMinutes = sessions.length > 0
        ? Math.round(sessions.reduce((sum, s) => sum + (s.total_time_minutes || 0), 0) / sessions.length)
        : 0;
      const tournamentsToday = tournaments.length;
      const tournamentEntries = tournaments.reduce((sum, t) => sum + (t.current_entries || 0), 0);

      return res.status(200).json({
        success: true,
        data: {
          summary: {
            period,
            activeTables,
            totalTables,
            runningGames,
            totalSeated,
            totalCapacity,
            occupancyRate: totalCapacity > 0 ? Math.round((totalSeated / totalCapacity) * 100) : 0,
            waitingPlayers,
            totalSessions,
            activeSessions,
            avgSessionMinutes,
            tournamentsToday,
            tournamentEntries
          },
          games,
          waitlistByGame: waitlist.reduce((acc, w) => {
            const key = `${w.game_type}-${w.stakes}`;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {}),
          dailyAnalytics
        }
      });
    } catch (error) {
      console.warn('Venue analytics error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch analytics' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
