/**
 * Waitlist Metrics Report API
 * GET /api/commander/reports/waitlist-metrics?venue_id=X&range=today|week|month
 * Returns: avg wait time, call-to-seat rate, no-show rate, peak demand, game type breakdown
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

      // Get all waitlist entries in range
      const { data: entries } = await getSupabase()
        .from('commander_waitlist')
        .select('id, player_name, game_type, stakes, status, position, created_at, called_at, seated_at, removed_at, phone')
        .eq('venue_id', venue_id)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });

      const all = entries || [];
      const total = all.length;

      // Status counts
      const seated = all.filter(e => e.status === 'seated')
      const called = all.filter(e => e.status === 'called')
      const noShows = all.filter(e => e.status === 'no_show' || e.status === 'passed');
      const removed = all.filter(e => e.status === 'removed' || e.status === 'cancelled');
      const waiting = all.filter(e => e.status === 'waiting');

      // Average wait time (created_at → seated_at or called_at)
      const waitTimes = all.filter(e => e.seated_at || e.called_at).map(e => {
        const endTime = new Date(e.seated_at || e.called_at);
        const startTime = new Date(e.created_at);
        return Math.max(0, (endTime - startTime) / (1000 * 60)); // minutes
      });
      const avgWaitMinutes = waitTimes.length > 0 ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0;
      const medianWait = waitTimes.length > 0 ? Math.round(waitTimes.sort((a, b) => a - b)[Math.floor(waitTimes.length / 2)]) : 0;
      const maxWait = waitTimes.length > 0 ? Math.round(Math.max(...waitTimes)) : 0;

      // Call-to-seat conversion
      const callToSeatRate = total > 0 ? Math.round((seated.length / total) * 100) : 0;
      const noShowRate = total > 0 ? Math.round((noShows.length / total) * 100) : 0;

      // Game type breakdown
      const byGame = {};
      all.forEach(e => {
        const key = `${e.game_type || 'Unknown'} ${e.stakes || ''}`.trim();
        if (!byGame[key]) byGame[key] = { total: 0, seated: 0, no_show: 0, avg_wait: [] };
        byGame[key].total++;
        if (e.status === 'seated') byGame[key].seated++;
        if (e.status === 'no_show' || e.status === 'passed') byGame[key].no_show++;
        if (e.seated_at || e.called_at) {
          const wt = Math.max(0, (new Date(e.seated_at || e.called_at) - new Date(e.created_at)) / (1000 * 60));
          byGame[key].avg_wait.push(wt);
        }
      });
      const gameBreakdown = Object.entries(byGame || {}).map(([game, data]) => ({
        game,
        total: data.total,
        seated: data.seated,
        no_show: data.no_show,
        conversion_rate: data.total > 0 ? Math.round((data.seated / data.total) * 100) : 0,
        avg_wait: data.avg_wait.length > 0 ? Math.round(data.avg_wait.reduce((a, b) => a + b, 0) / data.avg_wait.length) : 0,
      })).sort((a, b) => b.total - a.total);

      // Hourly demand
      const hourlyDemand = new Array(24).fill(0);
      all.forEach(e => {
        if (e.created_at) hourlyDemand[new Date(e.created_at).getHours()]++;
      });

      // Phone coverage (how many gave phone numbers)
      const withPhone = all.filter(e => e.phone).length;
      const phoneCoverage = total > 0 ? Math.round((withPhone / total) * 100) : 0;

      return res.status(200).json({
        success: true,
        data: {
          range: { start, end },
          summary: {
            total_entries: total,
            currently_waiting: waiting.length,
            seated: seated.length,
            no_shows: noShows.length,
            removed: removed.length + called.length,
            call_to_seat_rate: callToSeatRate,
            no_show_rate: noShowRate,
            phone_coverage: phoneCoverage,
          },
          wait_times: {
            average_minutes: avgWaitMinutes,
            median_minutes: medianWait,
            max_minutes: maxWait,
          },
          game_breakdown: gameBreakdown,
          hourly_demand: hourlyDemand,
        }
      });
    } catch (err) {
      console.warn('Waitlist metrics error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
