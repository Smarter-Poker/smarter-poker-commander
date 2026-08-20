/**
 * Daily Reports API
 * GET - Fetch daily summary report for a venue
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    if (req.method !== 'GET') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { venue_id, date } = req.query;

    if (!venue_id) {
      return res.status(400).json({ success: false, error: 'venue_id is required' });
    }

    const reportDate = date || new Date().toISOString().split('T')[0];
    const startOfDay = `${reportDate}T00:00:00.000Z`;
    const endOfDay = `${reportDate}T23:59:59.999Z`;

    try {
      // Fetch games that were active on this date
      const { data: games, error: gamesError } = await getSupabase()
        .from('commander_games')
        .select('*')
        .eq('venue_id', venue_id)
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay)

      if (gamesError) throw gamesError;

      // Fetch sessions for this date
      const { data: sessions, error: sessionsError } = await getSupabase()
        .from('commander_player_sessions')
        .select('*')
        .eq('venue_id', venue_id)
        .gte('check_in_at', startOfDay)
        .lte('check_in_at', endOfDay)

      if (sessionsError) throw sessionsError;

      // Fetch tournaments for this date
      const { data: tournaments, error: tournamentsError } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('venue_id', venue_id)
        .gte('scheduled_start', startOfDay)
        .lte('scheduled_start', endOfDay)

      if (tournamentsError) throw tournamentsError;

      // Fetch waitlist entries for this date
      const { data: waitlistEntries, error: waitlistError } = await getSupabase()
        .from('commander_waitlist')
        .select('*')
        .eq('venue_id', venue_id)
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay)

      if (waitlistError) throw waitlistError;

      // Calculate summary stats
      const uniquePlayers = new Set(sessions.map(s => s.player_id)).size;
      const totalHours = sessions.reduce((sum, s) => {
        if (s.check_out_at) {
          const duration = (new Date(s.check_out_at) - new Date(s.check_in_at)) / (1000 * 60 * 60);
          return sum + duration;
        }
        return sum;
      }, 0);

      // Group games by stakes
      const gamesByStakes = {};
      games.forEach(game => {
        const stakes = game.stakes || 'Unknown';
        if (!gamesByStakes[stakes]) {
          gamesByStakes[stakes] = { count: 0, tables: 0 };
        }
        gamesByStakes[stakes].count++;
        gamesByStakes[stakes].tables++;
      });

      // Calculate peak tables (max concurrent games)
      const peakTables = games.length > 0 ? Math.max(...Object.values(gamesByStakes || {}).map(g => g.tables)) : 0;

      // Get hourly breakdown
      const hourlyData = {};
      for (let i = 0; i < 24; i++) {
        hourlyData[i] = { players: 0, tables: 0 };
      }
      sessions.forEach(s => {
        const hour = new Date(s.check_in_at).getHours();
        hourlyData[hour].players++;
      });

      const report = {
        date: reportDate,
        venue_id,
        summary: {
          total_players: uniquePlayers,
          total_sessions: sessions.length,
          total_hours: Math.round(totalHours * 10) / 10,
          peak_tables: peakTables,
          active_games: games.filter(g => g.status === 'running').length,
          tournaments_run: tournaments.length,
          waitlist_joins: waitlistEntries.length
        },
        gamesByStakes: Object.entries(gamesByStakes || {}).map(([stakes, data]) => ({
          stakes,
          tables_run: data.tables,
          sessions: data.count
        })),
        tournaments: tournaments.map(t => ({
          id: t.id,
          name: t.name,
          buyin: t.buyin_amount,
          entries: t.current_entries || 0,
          prizepool: t.guaranteed_pool || 0,
          status: t.status
        })),
        hourlyBreakdown: Object.entries(hourlyData || {}).map(([hour, data]) => ({
          hour: parseInt(hour),
          players: data.players,
          tables: data.tables
        }))
      };

      return res.status(200).json({ success: true, data: { report } });

    } catch (error) {
      console.warn('Daily report error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
