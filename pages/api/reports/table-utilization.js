/**
 * Table Utilization Report API
 * GET /api/commander/reports/table-utilization?venue_id=X&range=today|week|month
 * Returns per-table usage: hours active, avg players, peak times, uptime %
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

function getDateRange(range) {
  const now = new Date();
  const start = new Date();
  switch (range) {
    case 'today': start.setHours(0, 0, 0, 0); break;
    case 'week': start.setDate(now.getDate() - 7); break;
    case 'month': start.setMonth(now.getMonth() - 1); break;
    default: start.setHours(0, 0, 0, 0);
  }
  return { start: start.toISOString(), end: now.toISOString() };
}

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Auth required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });

      const { venue_id, range = 'week' } = req.query;
      if (!venue_id) return res.status(400).json({ success: false, error: 'venue_id required' });

      const { data: staff } = await getSupabase()
        .from('commander_staff')
        .select('id')
        .eq('venue_id', venue_id)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (!staff) return res.status(403).json({ success: false, error: 'Staff access required' });

      const { start, end } = getDateRange(range);
      const rangeDays = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)));

      // Get all tables
      const { data: tables } = await getSupabase()
        .from('commander_tables')
        .select('id, table_number, table_name, max_seats, mode, status')
        .eq('venue_id', venue_id)
        .order('table_number');

      // Get all time sessions in range per table
      // 2026-07-28 audit fix: commander_table_sessions has no duration_minutes
      // column - selecting it errored the whole query (error was discarded), so
      // this report showed zero hours for every table. Duration is derived from
      // started_at/ended_at instead (an open session is measured only to the
      // end of the reporting window; see below).
      const { data: sessions, error: sessionsError } = await getSupabase()
        .from('commander_table_sessions')
        .select('table_number, started_at, ended_at, status')
        .eq('venue_id', venue_id)
        .gte('created_at', start)
        .lte('created_at', end)

      if (sessionsError) {
        console.error('[reports/table-utilization] commander_table_sessions read failed', {
          venue_id, code: sessionsError.code,
          message: sessionsError.message, details: sessionsError.details,
        });
        throw sessionsError;
      }

      // A session still marked open is measured only up to the end of the
      // reporting window (never past it), so a stale 'active' row cannot inflate
      // table hours with time it did not actually occupy.
      const windowEndMs = Math.min(Date.now(), new Date(end).getTime());
      const sessionMinutes = (s) => {
        if (!s?.started_at) return 0;
        const startMs = new Date(s.started_at).getTime();
        const rawEndMs = s.ended_at ? new Date(s.ended_at).getTime() : windowEndMs;
        const endMs = Math.min(rawEndMs, windowEndMs);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
        return (endMs - startMs) / 60000;
      };

      // Get tournament entries (for tournament table usage)
      const { data: tEntries } = await getSupabase()
        .from('commander_tournament_entries')
        .select('table_number, created_at, status')
        .eq('status', 'active')
        .gte('created_at', start)

      // Build per-table stats
      const tableStats = (tables || []).map(table => {
        const tSessions = (sessions || []).filter(s => s.table_number === table.table_number)
        const totalMinutes = tSessions.reduce((sum, s) => sum + sessionMinutes(s), 0);
        const totalHours = Math.round(totalMinutes / 60 * 10) / 10;
        const sessionCount = tSessions.length;

        // Unique players estimate (count sessions)
        const uniquePlayers = new Set(tSessions.map(s => `${s.started_at}`)).size;

        // Hours per day
        const hoursPerDay = Math.round((totalHours / rangeDays) * 10) / 10;

        // Uptime % (assume 12-hour operating day)
        const totalPossibleHours = rangeDays * 12;
        const uptimePercent = totalPossibleHours > 0 ? Math.min(100, Math.round((totalHours / totalPossibleHours) * 100)) : 0;

        // Peak hour analysis
        const hourBuckets = new Array(24).fill(0);
        tSessions.forEach(s => {
          if (s.started_at) {
            const hour = new Date(s.started_at).getHours();
            hourBuckets[hour]++;
          }
        });
        const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));

        // Avg players at table (concurrent sessions estimate)
        const avgPlayers = sessionCount > 0 ? Math.round((totalMinutes / (rangeDays * 12 * 60)) * table.max_seats * 10) / 10 : 0;

        return {
          table_number: table.table_number,
          table_name: table.table_name,
          max_seats: table.max_seats,
          current_mode: table.mode || 'inactive',
          current_status: table.status,
          total_hours: totalHours,
          hours_per_day: hoursPerDay,
          session_count: sessionCount,
          avg_players: Math.min(avgPlayers, table.max_seats),
          uptime_percent: uptimePercent,
          peak_hour: peakHour,
        };
      });

      // Overall stats
      const totalTableHours = tableStats.reduce((s, t) => s + t.total_hours, 0);
      const totalSessions = tableStats.reduce((s, t) => s + t.session_count, 0);
      const avgUptime = tableStats.length > 0 ? Math.round(tableStats.reduce((s, t) => s + t.uptime_percent, 0) / tableStats.length) : 0;
      const busiestTable = tableStats.reduce((best, t) => t.total_hours > (best?.total_hours || 0) ? t : best, null);

      // Hourly heatmap (all tables combined)
      const hourlyHeatmap = new Array(24).fill(0);
      (sessions || []).forEach(s => {
        if (s.started_at) {
          const hour = new Date(s.started_at).getHours();
          hourlyHeatmap[hour]++;
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          range: { start, end, days: rangeDays },
          summary: {
            total_tables: (tables || []).length,
            active_tables: tableStats.filter(t => t.session_count > 0).length,
            total_table_hours: Math.round(totalTableHours * 10) / 10,
            total_sessions: totalSessions,
            avg_uptime_percent: avgUptime,
            busiest_table: busiestTable?.table_number || null,
          },
          tables: tableStats,
          hourly_heatmap: hourlyHeatmap,
        }
      });
    } catch (err) {
      console.warn('Table utilization error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
