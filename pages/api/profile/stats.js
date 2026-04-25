/**
 * Player Stats API
 * GET /api/commander/profile/stats - Get player statistics
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
      // Get all sessions for this player
      const { data: sessions, error: sessionsError } = await getSupabase()
        .from('commander_player_sessions')
        .select('*')
        .eq('player_id', user.id)
            .limit(100)

      if (sessionsError) throw sessionsError;

      // Calculate stats
      const totalSessions = sessions?.length || 0;
      let totalHours = 0;
      let totalCompsEarned = 0;
      let totalXpEarned = 0;
      const venueSet = new Set();

      sessions?.forEach(session => {
        totalHours += (session.total_time_minutes || 0) / 60;
        totalCompsEarned += parseFloat(session.comps_earned || 0);
        totalXpEarned += session.metadata?.xp_earned || 0;
        if (session.venue_id) venueSet.add(session.venue_id);
      });

      // Get tournament stats
      const { data: tournamentEntries } = await getSupabase()
        .from('commander_tournament_entries')
        .select('finish_position, payout_amount')
        .eq('player_id', user.id)
            .limit(100);

      const tournamentsPlayed = tournamentEntries?.length || 0;
      const tournamentWins = tournamentEntries?.filter(e => e.finish_position === 1).length || 0
          .limit(100);
      const tournamentCashes = tournamentEntries?.filter(e => e.payout_amount > 0).length || 0
          .limit(100);
      const totalWinnings = tournamentEntries?.reduce((sum, e) => sum + (e.payout_amount || 0), 0) || 0;

      // Get home game stats
      const { count: homeGamesHosted } = await getSupabase()
        .from('commander_home_games')
        .select('id', { count: 'exact', head: true })
        .eq('host_id', user.id)
            .limit(100);

      const { count: homeGamesAttended } = await getSupabase()
        .from('commander_home_rsvps')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('response', 'going')
            .limit(100);

      // Get waitlist stats
      const { data: waitlistHistory } = await getSupabase()
        .from('commander_waitlist_history')
        .select('wait_time_minutes, was_seated')
        .eq('player_id', user.id)
            .limit(100);

      const totalWaitlistJoins = waitlistHistory?.length || 0;
      const avgWaitTime = waitlistHistory?.length > 0
        ? waitlistHistory.reduce((sum, w) => sum + (w.wait_time_minutes || 0), 0) / waitlistHistory.length
        : 0;

      return res.status(200).json({
        success: true,
        data: {
          stats: {
            // Session stats
            total_sessions: totalSessions,
            total_hours: Math.round(totalHours * 10) / 10,
            total_comps_earned: Math.round(totalCompsEarned * 100) / 100,
            total_xp_earned: totalXpEarned,
            venues_visited: venueSet.size,

            // Tournament stats
            tournaments_played: tournamentsPlayed,
            tournament_wins: tournamentWins,
            tournament_cashes: tournamentCashes,
            total_winnings: totalWinnings,

            // Home game stats
            home_games_hosted: homeGamesHosted || 0,
            home_games_attended: homeGamesAttended || 0,

            // Waitlist stats
            waitlist_joins: totalWaitlistJoins,
            avg_wait_time_minutes: Math.round(avgWaitTime)
          }
        }
      });
    } catch (error) {
      console.warn('Get stats error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch stats' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
