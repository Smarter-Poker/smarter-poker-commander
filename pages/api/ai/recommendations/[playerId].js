/**
 * AI Player Recommendations API
 * GET /api/commander/ai/recommendations/[playerId]
 * Returns personalized game recommendations for player
 * Per API_REFERENCE.md
 * Requires staff authentication.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF — requires valid staff session
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    // Require staff auth — exposes player session history and preferences
    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { playerId } = req.query;

    if (!playerId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'player_id required' }
      });
    }

    try {
      // 2026-07-25 audit fix: scope all player-history queries to the staff
      // member's own venue — any staff could previously read a player's
      // cross-venue history. Also fixed the nonexistent total_minutes column
      // (real column: total_time_minutes).
      const { data: sessions, error: sessionsError } = await getSupabase()
        .from('commander_player_sessions')
        .select('venue_id, games_played, total_time_minutes, check_in_at')
        .eq('player_id', playerId)
        .eq('venue_id', staff.venue_id)
        .order('check_in_at', { ascending: false })
        .limit(50);

      if (sessionsError) {
        console.warn('Sessions fetch error:', sessionsError);
      }

      // Get player's waitlist history (this venue only)
      const { data: waitlistHistory, error: waitlistError } = await getSupabase()
        .from('commander_waitlist_history')
        .select('venue_id, game_type, stakes, wait_time_minutes, was_seated')
        .eq('player_id', playerId)
        .eq('venue_id', staff.venue_id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (waitlistError) {
        console.warn('Waitlist history error:', waitlistError);
      }

      // 2026-07-25 audit fix: 404 when the player has no activity at this venue
      // rather than generating recommendations from empty data.
      if ((sessions || []).length === 0 && (waitlistHistory || []).length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No player activity at this venue' }
        });
      }

      // Get player preferences if they exist
      const { data: preferences } = await getSupabase()
        .from('commander_player_preferences')
        .select('id')
        .eq('player_id', playerId)
        .maybeSingle();

      // Analyze player patterns
      const gameTypeCount = {};
      const stakesCount = {};
      const venueCount = {};
      let totalSessions = 0;
      let totalMinutes = 0;

      // Process session data
      (sessions || []).forEach(session => {
        totalSessions++;
        // 2026-07-25 audit fix: real column is total_time_minutes.
        totalMinutes += session.total_time_minutes || 0;

        if (session.venue_id) {
          venueCount[session.venue_id] = (venueCount[session.venue_id] || 0) + 1;
        }

        // Parse games_played JSON
        const games = session.games_played || [];
        games.forEach(game => {
          if (game.game_type) {
            gameTypeCount[game.game_type] = (gameTypeCount[game.game_type] || 0) + 1;
          }
          if (game.stakes) {
            stakesCount[game.stakes] = (stakesCount[game.stakes] || 0) + 1;
          }
        });
      });

      // Also process waitlist history
      (waitlistHistory || []).forEach(entry => {
        if (entry.game_type) {
          gameTypeCount[entry.game_type] = (gameTypeCount[entry.game_type] || 0) + 0.5;
        }
        if (entry.stakes) {
          stakesCount[entry.stakes] = (stakesCount[entry.stakes] || 0) + 0.5;
        }
      });

      // Determine player's preferred game type and stakes
      const preferredGameType = Object.keys(gameTypeCount || {}).sort(
        (a, b) => gameTypeCount[b] - gameTypeCount[a]
      )[0] || 'nlhe';

      const preferredStakes = Object.keys(stakesCount || {}).sort(
        (a, b) => stakesCount[b] - stakesCount[a]
      )[0] || '1/3';

      const favoriteVenue = Object.keys(venueCount || {}).sort(
        (a, b) => venueCount[b] - venueCount[a]
      )[0];

      // Generate recommendations
      const recommendations = [];

      // Primary game recommendation
      recommendations.push({
        type: 'game',
        data: {
          game_type: preferredGameType,
          stakes: preferredStakes
        },
        reason: `Based on your ${totalSessions} sessions, you prefer ${preferredGameType.toUpperCase()} at ${preferredStakes}`,
        score: 0.95
      });

      // Stakes upgrade recommendation (if they play enough)
      if (totalSessions >= 10 && preferredStakes === '1/3') {
        recommendations.push({
          type: 'stakes',
          data: {
            current_stakes: '1/3',
            suggested_stakes: '2/5',
            game_type: preferredGameType
          },
          reason: 'With your experience level, consider moving up to 2/5 for potentially better game quality',
          score: 0.72
        });
      }

      // Alternative game type recommendation
      const altGameType = preferredGameType === 'nlhe' ? 'plo' : 'nlhe';
      recommendations.push({
        type: 'game',
        data: {
          game_type: altGameType,
          stakes: altGameType === 'plo' ? '1/2' : preferredStakes
        },
        reason: `Try ${altGameType.toUpperCase()} for variety - many ${preferredGameType.toUpperCase()} players enjoy it`,
        score: 0.65
      });

      // Venue recommendation if they have a favorite
      if (favoriteVenue) {
        recommendations.push({
          type: 'venue',
          data: {
            venue_id: favoriteVenue,
            visits: venueCount[favoriteVenue]
          },
          reason: `Your most visited venue with ${venueCount[favoriteVenue]} sessions`,
          score: 0.88
        });
      }

      // Training recommendation based on session patterns
      const avgSessionMinutes = totalSessions > 0 ? totalMinutes / totalSessions : 0;
      if (avgSessionMinutes < 120) {
        recommendations.push({
          type: 'training',
          data: {
            module: 'session_management',
            topic: 'Optimal Session Length'
          },
          reason: 'Your average session is under 2 hours - learn optimal session management',
          score: 0.58
        });
      }

      // Table vibe recommendation based on preferences
      if (preferences?.table_vibe) {
        recommendations.push({
          type: 'game',
          data: {
            table_vibe: preferences.table_vibe,
            game_type: preferredGameType
          },
          reason: `Look for ${preferences.table_vibe} tables that match your play style`,
          score: 0.70
        });
      }

      // Sort by score
      recommendations.sort((a, b) => b.score - a.score);

      return res.status(200).json({
        success: true,
        data: {
          recommendations: recommendations.slice(0, 5), // Top 5 recommendations
          player_profile: {
            total_sessions: totalSessions,
            total_hours: Math.round(totalMinutes / 60),
            preferred_game_type: preferredGameType,
            preferred_stakes: preferredStakes,
            favorite_venue: favoriteVenue
          },
          generated_at: new Date().toISOString()
        }
      });

    } catch (error) {
      console.warn('AI recommendations error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to generate recommendations' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
