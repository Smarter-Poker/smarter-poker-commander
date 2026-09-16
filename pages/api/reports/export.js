/**
 * Reports Export API
 * GET /api/commander/reports/export - Export daily report as CSV or PDF
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { requireStaff } from '../../../src/lib/commander/auth';
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

// 2026-07-25 audit fix: CSV cell escaping (mirrors pages/api/exports/index.js).
// Quotes cells containing delimiters, doubles embedded quotes, and prefixes
// leading =,+,-,@ with an apostrophe to block spreadsheet formula injection.
function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  let v = String(value);
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r') || v !== String(value)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
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

    const { venue_id, date, format = 'csv' } = req.query;

    if (!venue_id || !date) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'venue_id and date are required' }
      });
    }

    // Require manager auth to export reports
    const staff = await requireStaff(req, res, venue_id, ['owner', 'manager']);
    if (!staff) return;

    try {
      // Get venue info
      const { data: venue } = await getSupabase()
        .from('poker_venues')
        .select('id, name')
        .eq('id', venue_id)
        .maybeSingle();

      if (!venue) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Venue not found' }
        });
      }

      const startOfDay = `${date}T00:00:00`;
      const endOfDay = `${date}T23:59:59`;

      // Fetch games for the day
      // 2026-07-28 audit fix: commander_games has closed_at, not ended_at.
      // The bad column errored this query too (error discarded), so the games
      // section of every exported report was empty.
      const { data: games, error: gamesError } = await getSupabase()
        .from('commander_games')
        .select(`
          id, game_type, stakes, status, current_players, max_players,
          started_at, closed_at,
          commander_tables:table_id (id, table_number)
        `)
        .eq('venue_id', venue_id)
        .gte('started_at', startOfDay)
        .lte('started_at', endOfDay)

      if (gamesError) {
        console.error('[reports/export] commander_games read failed', {
          venue_id, date, code: gamesError.code,
          message: gamesError.message, details: gamesError.details,
        });
        throw gamesError;
      }

      // Fetch sessions for the day
      // 2026-07-28 audit fix: commander_sessions has no player_id/check_in_time/
      // check_out_time columns - the real ones are user_id/started_at/ended_at.
      // The bad names errored the query and the error was discarded, so
      // "Unique Players" silently printed 0 on every exported report.
      // NOTE (unresolved, reported to the owner): commander_sessions.venue_id is
      // uuid while poker_venues.id is integer, so this venue filter can still
      // never match. That is now a LOUD failure instead of a silent zero.
      const { data: sessions, error: sessionsError } = await getSupabase()
        .from('commander_sessions')
        .select('id, user_id, started_at, ended_at')
        .eq('venue_id', venue_id)
        .gte('started_at', startOfDay)
        .lte('started_at', endOfDay)

      if (sessionsError) {
        console.error('[reports/export] commander_sessions read failed', {
          venue_id, date, code: sessionsError.code,
          message: sessionsError.message, details: sessionsError.details,
        });
        throw sessionsError;
      }

      // Fetch comp transactions (from the actual comp log table)
      const { data: comps } = await getSupabase()
        .from('commander_member_comp_log')
        .select('id, amount, type')
        .eq('venue_id', venue_id)
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay)

      // Calculate summary
      const totalGames = games?.length || 0;
      const uniquePlayers = new Set(sessions?.map(s => s.user_id) || []).size;
      const totalHours = games?.reduce((sum, g) => {
        if (g.closed_at) {
          const hours = (new Date(g.closed_at) - new Date(g.started_at)) / (1000 * 60 * 60);
          return sum + hours;
        }
        return sum;
      }, 0) || 0;
      const totalComps = comps?.reduce((sum, c) => {
        return sum + (c.type === 'award' || c.type === 'auto_hourly' || !c.type ? Math.abs(parseFloat(c.amount) || 0) : 0);
      }, 0) || 0;

      if (format === 'csv') {
        // Generate CSV
        const csvRows = [
          ['Daily Report', venue.name, date],
          [],
          ['Summary'],
          ['Metric', 'Value'],
          ['Total Games', totalGames],
          ['Unique Players', uniquePlayers],
          ['Table Hours', totalHours.toFixed(1)],
          ['Comps Issued', `$${totalComps.toFixed(2)}`],
          [],
          ['Games Detail'],
          ['Game Type', 'Stakes', 'Table', 'Status', 'Players', 'Started', 'Duration (hrs)']
        ];

        games?.forEach(g => {
          const duration = g.closed_at
            ? ((new Date(g.closed_at) - new Date(g.started_at)) / (1000 * 60 * 60)).toFixed(1)
            : 'Running';
          csvRows.push([
            g.game_type?.toUpperCase() || 'NLHE',
            g.stakes || 'N/A',
            g.commander_tables?.table_number || 'N/A',
            g.status,
            `${g.current_players || 0}/${g.max_players || 9}`,
            new Date(g.started_at).toLocaleTimeString(),
            duration
          ]);
        });

        // 2026-07-25 audit fix: escape each cell (replicates the exports/index.js
        // helper) - quote cells, double embedded quotes, and guard leading
        // =,+,-,@ against spreadsheet formula injection. Raw joins broke rows
        // containing commas/quotes and allowed formula injection.
        const csvContent = csvRows.map(row => row.map(escapeCsvCell).join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=report-${date}.csv`);
        return res.status(200).send(csvContent);
      }

      // Return JSON if format not CSV
      return res.status(200).json({
        success: true,
        data: {
          venue: venue.name,
          date,
          summary: {
            totalGames,
            uniquePlayers,
            totalHours: totalHours.toFixed(1),
            totalComps: totalComps.toFixed(2)
          },
          games: games || []
        }
      });
    } catch (error) {
      console.warn('Export report error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to export report' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
