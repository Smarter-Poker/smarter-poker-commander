/**
 * Auto Game Start Intelligence API
 * GET /api/commander/ai/game-start — Analyze whether new tables should open
 *
 * Factors:
 * - Current waitlist depth per game type
 * - Historical demand patterns (day-of-week, time-of-day)
 * - Available dealer count vs assigned
 * - Open table inventory
 * - Player interest signals
 *
 * Requires staff authentication.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF — requires valid staff session
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });
    }

    // Require staff auth — exposes venue operational data
    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { venue_id } = req.query;
    if (!venue_id) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id required' } });
    }

    // 2026-07-25 audit fix: staff can only read operational data for their own venue.
    if (String(staff.venue_id) !== String(venue_id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' } });
    }

    try {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sun
      const hour = now.getHours();

      // 1. Current waitlist by game type
      const { data: waitlistEntries } = await getSupabase()
        .from('commander_waitlist')
        .select('game_type, player_name, created_at')
        .eq('venue_id', venue_id)
        .eq('status', 'waiting')
        .order('created_at', { ascending: true })
            .limit(100)

      const waitlistByGame = {};
      (waitlistEntries || []).forEach(w => {
        const gt = w.game_type || 'Unknown';
        if (!waitlistByGame[gt]) waitlistByGame[gt] = [];
        waitlistByGame[gt].push(w);
      });

      // 2. Current open tables
      const { data: tables } = await getSupabase()
        .from('commander_tables')
        .select('id, table_number, game_type, status')
        .eq('venue_id', venue_id)
            .limit(100)

      const openTables = (tables || []).filter(t => t.status === 'available' || t.status === 'inactive');
      const activeTables = (tables || []).filter(t => t.status === 'active' || t.status === 'in_use');
      const tablesByGame = {};
      activeTables.forEach(t => {
        const gt = t.game_type || 'Unknown';
        if (!tablesByGame[gt]) tablesByGame[gt] = 0;
        tablesByGame[gt]++;
      });

      // 3. Available dealers
      const { data: dealers } = await getSupabase()
        .from('commander_dealers')
        .select('id, status')
        .eq('venue_id', venue_id)
            .limit(100)

      const availableDealers = (dealers || []).filter(d => d.status === 'available' || d.status === 'on_break').length;
      const busyDealers = (dealers || []).filter(d => d.status === 'dealing' || d.status === 'assigned').length;

      // 4. Historical demand (same day-of-week, next 2 hours)
      const twoWeeksAgo = new Date(now - 14 * 86400000).toISOString();
      const { data: historicalSessions } = await getSupabase()
        .from('commander_player_sessions')
        .select('check_in_at, game_type')
        .eq('venue_id', venue_id)
        .gte('check_in_at', twoWeeksAgo)

      // Count sessions that started on same day-of-week within +/- 2 hours
      const demandByGame = {};
      let sameWindowCount = 0;
      (historicalSessions || []).forEach(s => {
        const d = new Date(s.check_in_at);
        if (d.getDay() === dayOfWeek && Math.abs(d.getHours() - hour) <= 2) {
          const gt = s.game_type || 'Unknown';
          if (!demandByGame[gt]) demandByGame[gt] = 0;
          demandByGame[gt]++;
          sameWindowCount++;
        }
      });

      // 5. Generate recommendations
      const recommendations = [];

      for (const [gameType, waiters] of Object.entries(waitlistByGame || {})) {
        const waitCount = waiters.length;
        const currentTables = tablesByGame[gameType] || 0;
        const historicalDemand = demandByGame[gameType] || 0;
        const hasOpenTable = openTables.length > 0;
        const hasDealer = availableDealers > 0;

        // Threshold: 7+ waiters = strong signal, 5+ = moderate
        let confidence = 'low';
        let action = 'monitor';
        const reasons = [];

        if (waitCount >= 7) {
          confidence = 'high';
          action = 'open_now';
          reasons.push(`${waitCount} players waiting (exceeds 7-player threshold)`);
        } else if (waitCount >= 5) {
          confidence = 'medium';
          action = 'open_soon';
          reasons.push(`${waitCount} players waiting (approaching threshold)`);
        }

        // Historical boost
        if (historicalDemand > 5) {
          if (confidence === 'medium') { confidence = 'high'; action = 'open_now'; }
          else if (confidence === 'low') { confidence = 'medium'; action = 'open_soon'; }
          reasons.push(`High historical demand: ~${historicalDemand} sessions at this time on ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek]}s`);
        }

        // Peak hour boost (Fri/Sat 6-10pm)
        if ((dayOfWeek === 5 || dayOfWeek === 6) && hour >= 18 && hour <= 22) {
          reasons.push('Peak hours (weekend evening)');
          if (confidence === 'low') { confidence = 'medium'; action = 'open_soon'; }
        }

        // Blockers
        if (!hasOpenTable) {
          reasons.push('⚠ No open tables available');
          if (action === 'open_now') action = 'blocked';
        }
        if (!hasDealer) {
          reasons.push('⚠ No available dealers');
          if (action === 'open_now') action = 'blocked';
        }

        // Oldest waiter time
        const oldestWait = waiters.length > 0
          ? Math.round((now - new Date(waiters[0].created_at)) / 60000)
          : 0;

        recommendations.push({
          game_type: gameType,
          waitlist_count: waitCount,
          active_tables: currentTables,
          oldest_wait_minutes: oldestWait,
          confidence,
          action,
          reasons,
          historical_demand_score: historicalDemand
        });
      }

      // Sort: open_now first, then open_soon, then monitor
      const priority = { open_now: 0, blocked: 1, open_soon: 2, monitor: 3 };
      recommendations.sort((a, b) => (priority[a.action] || 9) - (priority[b.action] || 9));

      return res.status(200).json({
        success: true,
        data: {
          recommendations,
          venue_state: {
            open_tables: openTables.length,
            active_tables: activeTables.length,
            available_dealers: availableDealers,
            busy_dealers: busyDealers,
            total_waiting: (waitlistEntries || []).length
          },
          context: {
            day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
            hour,
            is_peak: (dayOfWeek === 5 || dayOfWeek === 6) && hour >= 18 && hour <= 22
          },
          generated_at: now.toISOString()
        }
      });
    } catch (error) {
      console.warn('Game start intelligence error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
