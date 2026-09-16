/**
 * Player Churn Prediction API
 * GET /api/commander/ai/churn-prediction - Get churn risk scores for venue players
 *
 * Analyzes player visit patterns to predict who may not return:
 * - Visit frequency decline
 * - Session duration changes
 * - Time since last visit
 * - Comparison to personal baseline
 *
 * Requires staff authentication.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.ai)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });
    }

    // Require staff auth - exposes player names and visit analytics
    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { venue_id, limit = 50 } = req.query;
    if (!venue_id) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id required' } });
    }

    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();
      const sixtyDaysAgo = new Date(now - 60 * 86400000).toISOString();
      const ninetyDaysAgo = new Date(now - 90 * 86400000).toISOString();

      // Get all sessions in last 90 days
      const { data: sessions, error } = await getSupabase()
        .from('commander_player_sessions')
        .select('player_id, check_in_at, total_time_minutes, total_buyin')
        .eq('venue_id', venue_id)
        .gte('check_in_at', ninetyDaysAgo)
        // 2026-07-25 audit fix: removed .limit(100) - the cap silently truncated
        // the 90-day aggregation this prediction is computed from.
        .order('check_in_at', { ascending: false })

      if (error) throw error;

      // Group by player
      const playerMap = {};
      (sessions || []).forEach(s => {
        if (!s.player_id) return;
        if (!playerMap[s.player_id]) {
          playerMap[s.player_id] = { sessions: [], last30: 0, prev30: 0, prev60: 0 };
        }
        playerMap[s.player_id].sessions.push(s);
        const ts = new Date(s.check_in_at);
        if (ts >= new Date(thirtyDaysAgo)) playerMap[s.player_id].last30++;
        else if (ts >= new Date(sixtyDaysAgo)) playerMap[s.player_id].prev30++;
        else playerMap[s.player_id].prev60++;
      });

      // Get player names
      const playerIds = Object.keys(playerMap || {});
      let nameMap = {};
      if (playerIds.length > 0) {
        const { data: profiles } = await getSupabase()
          .from('profiles')
          .select('id, display_name, full_name')
          .limit(100)
          .in('id', playerIds.slice(0, 200));
        (profiles || []).forEach(p => { nameMap[p.id] = p.display_name || p.full_name || 'Unknown'; });
      }

      // Calculate churn risk for each player
      const predictions = [];

      for (const [playerId, data] of Object.entries(playerMap || {})) {
        const { sessions: playerSessions, last30, prev30, prev60 } = data;
        const totalSessions = playerSessions.length;
        if (totalSessions < 2) continue; // Need baseline

        // Last visit
        const lastVisit = new Date(playerSessions[0].check_in_at);
        const daysSinceVisit = Math.floor((now - lastVisit) / 86400000);

        // Average session gap (days between visits)
        const sortedSessions = playerSessions.sort((a, b) => new Date(a.check_in_at) - new Date(b.check_in_at));
        let totalGap = 0;
        let gapCount = 0;
        for (let i = 1; i < sortedSessions.length; i++) {
          const gap = (new Date(sortedSessions[i].check_in_at) - new Date(sortedSessions[i - 1].check_in_at)) / 86400000;
          totalGap += gap;
          gapCount++;
        }
        const avgGapDays = gapCount > 0 ? totalGap / gapCount : 14;

        // Average session duration
        const avgDuration = playerSessions.reduce((s, x) => s + (x.total_time_minutes || 0), 0) / totalSessions;

        // Risk factors
        let riskScore = 0;
        const factors = [];

        // Factor 1: Days since last visit vs average gap (0-35 points)
        const gapRatio = daysSinceVisit / Math.max(avgGapDays, 1);
        if (gapRatio > 3) { riskScore += 35; factors.push('Overdue by 3x normal gap'); }
        else if (gapRatio > 2) { riskScore += 25; factors.push('Overdue by 2x normal gap'); }
        else if (gapRatio > 1.5) { riskScore += 15; factors.push('Past normal visit window'); }

        // Factor 2: Visit frequency decline (0-30 points)
        const prevAvg = (prev30 + prev60) / 2;
        if (prevAvg > 0 && last30 < prevAvg * 0.5) { riskScore += 30; factors.push('Visits dropped >50%'); }
        else if (prevAvg > 0 && last30 < prevAvg * 0.75) { riskScore += 15; factors.push('Visit frequency declining'); }

        // Factor 3: Zero visits in last 30 days (0-20 points)
        if (last30 === 0 && (prev30 > 0 || prev60 > 0)) { riskScore += 20; factors.push('No visits in 30 days'); }

        // Factor 4: Short last session vs average (0-15 points)
        const lastDuration = playerSessions[0].total_time_minutes || 0;
        if (lastDuration > 0 && avgDuration > 0 && lastDuration < avgDuration * 0.5) {
          riskScore += 15; factors.push('Last session unusually short');
        }

        // Cap at 100
        riskScore = Math.min(riskScore, 100);

        // Risk category
        let risk = 'low';
        if (riskScore >= 70) risk = 'high';
        else if (riskScore >= 40) risk = 'medium';

        predictions.push({
          player_id: playerId,
          player_name: nameMap[playerId] || 'Unknown',
          risk_score: riskScore,
          risk,
          days_since_visit: daysSinceVisit,
          avg_gap_days: Math.round(avgGapDays),
          visits_last_30: last30,
          visits_prev_30: prev30,
          total_sessions_90d: totalSessions,
          avg_session_minutes: Math.round(avgDuration),
          factors
        });
      }

      // Sort by risk score descending
      predictions.sort((a, b) => b.risk_score - a.risk_score);

      // Summary
      const summary = {
        total_players_analyzed: predictions.length,
        high_risk: predictions.filter(p => p.risk === 'high').length,
        medium_risk: predictions.filter(p => p.risk === 'medium').length,
        low_risk: predictions.filter(p => p.risk === 'low').length,
        avg_risk_score: predictions.length > 0 ? Math.round(predictions.reduce((s, p) => s + p.risk_score, 0) / predictions.length) : 0
      };

      return res.status(200).json({
        success: true,
        data: {
          predictions: predictions.slice(0, parseInt(limit)),
          summary,
          generated_at: now.toISOString()
        }
      });
    } catch (error) {
      console.warn('Churn prediction error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
