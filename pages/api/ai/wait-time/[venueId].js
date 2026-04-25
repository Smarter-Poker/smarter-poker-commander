/**
 * AI Wait Time Prediction API
 * GET /api/commander/ai/wait-time/[venueId]
 * Returns predicted wait times for games at venue
 * Per API_REFERENCE.md
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
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
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'venue_id required' }
      });
    }

    try {
      // Get current hour and day for predictions
      const now = new Date();
      const hourOfDay = now.getHours();
      const dayOfWeek = now.getDay();

      // Get current waitlist counts by game type and stakes
      const { data: waitlists, error: waitlistError } = await getSupabase()
        .from('commander_waitlist')
        .select('game_type, stakes, created_at')
        .eq('venue_id', venueId)
        .eq('status', 'waiting')
            .limit(100)

      if (waitlistError) {
        console.warn('Waitlist fetch error:', waitlistError);
      }

      // Get active games to calculate turnover
      const { data: games, error: gamesError } = await getSupabase()
        .from('commander_games')
        .select('id, game_type, stakes, current_players, max_players, started_at')
        .eq('venue_id', venueId)
        .eq('status', 'running')

      if (gamesError) {
        console.warn('Games fetch error:', gamesError);
      }

      // Get historical wait time data for this venue
      const { data: history, error: historyError } = await getSupabase()
        .from('commander_waitlist_history')
        .select('game_type, stakes, wait_time_minutes, was_seated, created_at')
        .eq('venue_id', venueId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(500);

      if (historyError) {
        console.warn('History fetch error:', historyError);
      }

      // Group waitlist by game type and stakes
      const waitlistByGame = {};
      (waitlists || []).forEach(entry => {
        const key = `${entry.game_type || 'nlhe'}_${entry.stakes || '1/3'}`;
        if (!waitlistByGame[key]) {
          waitlistByGame[key] = { count: 0, game_type: entry.game_type || 'nlhe', stakes: entry.stakes || '1/3' };
        }
        waitlistByGame[key].count++;
      });

      // Calculate historical averages
      const historicalAverages = {};
      (history || []).forEach(entry => {
        if (entry.was_seated && entry.wait_time_minutes) {
          const key = `${entry.game_type || 'nlhe'}_${entry.stakes || '1/3'}`;
          if (!historicalAverages[key]) {
            historicalAverages[key] = { total: 0, count: 0 };
          }
          historicalAverages[key].total += entry.wait_time_minutes;
          historicalAverages[key].count++;
        }
      });

      // Generate predictions for each game type/stakes combination
      const predictions = [];
      const gameTypes = new Set([
        ...Object.keys(waitlistByGame || {}),
        ...Object.keys(historicalAverages || {})
      ]);

      // Also add common game types for this venue
      const commonGames = [
        { game_type: 'nlhe', stakes: '1/3' },
        { game_type: 'nlhe', stakes: '2/5' },
        { game_type: 'plo', stakes: '1/2' }
      ];

      commonGames.forEach(g => {
        gameTypes.add(`${g.game_type}_${g.stakes}`);
      });

      gameTypes.forEach(key => {
        const [gameType, stakes] = key.split('_');
        const waitlistData = waitlistByGame[key] || { count: 0 };
        const histData = historicalAverages[key];

        // Base prediction algorithm
        let baseMinutes = 15; // Default 15 minutes per position
        let confidence = 0.5;

        if (histData && histData.count > 5) {
          // Use historical average if we have enough data
          baseMinutes = histData.total / histData.count;
          confidence = Math.min(0.9, 0.5 + (histData.count / 100));
        }

        // Adjust for current conditions
        const currentCount = waitlistData.count;
        let estimatedMinutes = Math.round(currentCount * baseMinutes);

        // Time-of-day adjustments
        const factors = {
          historicalAverage: histData ? Math.round(histData.total / histData.count) : 15,
          currentTurnover: 0,
          timeOfDay: 0,
          dayOfWeek: 0,
          specialEvents: 0
        };

        // Peak hours (6pm-10pm) tend to have longer waits
        if (hourOfDay >= 18 && hourOfDay <= 22) {
          factors.timeOfDay = 1.2;
          estimatedMinutes = Math.round(estimatedMinutes * 1.2);
        } else if (hourOfDay >= 10 && hourOfDay < 18) {
          factors.timeOfDay = 0.9;
          estimatedMinutes = Math.round(estimatedMinutes * 0.9);
        }

        // Weekend adjustments (Fri-Sat)
        if (dayOfWeek === 5 || dayOfWeek === 6) {
          factors.dayOfWeek = 1.15;
          estimatedMinutes = Math.round(estimatedMinutes * 1.15);
        }

        // Calculate turnover from running games
        const runningGames = (games || []).filter(
          g => g.game_type === gameType && g.stakes === stakes
        );
        if (runningGames.length > 0) {
          factors.currentTurnover = runningGames.length;
          // More tables = faster seating
          estimatedMinutes = Math.round(estimatedMinutes / Math.max(1, runningGames.length * 0.7));
        }

        // Generate recommendation if applicable
        let recommendation = null;
        if (currentCount > 5 && gameType === 'nlhe' && stakes === '1/3') {
          recommendation = 'Consider 2/5 NLH - typically shorter wait';
        }

        predictions.push({
          game_type: gameType,
          stakes: stakes,
          estimated_minutes: Math.max(0, estimatedMinutes),
          confidence: Math.round(confidence * 100) / 100,
          factors,
          recommendation,
          current_waitlist: currentCount,
          tables_running: runningGames.length
        });
      });

      // Sort by waitlist size
      predictions.sort((a, b) => b.current_waitlist - a.current_waitlist);

      return res.status(200).json({
        success: true,
        data: {
          predictions,
          generated_at: new Date().toISOString(),
          venue_id: venueId
        }
      });

    } catch (error) {
      console.warn('AI wait time error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to generate predictions' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
