/**
 * Home Game Matchmaker API
 * GET /api/commander/home-games/matchmaker
 *
 * Uses Grok AI to intelligently match players with compatible home games
 * and groups based on preferences, play history, location, and schedule.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { getAIClient } from '../../../src/lib/grokClient';
import { reportApiError } from '../../../src/lib/sentryWrap';

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
/** Escape SQL LIKE wildcards */
function escapeIlike(s) { return (s || '').replace(/[%_\\]/g, c => '\\' + c); }

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.ai)) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
      });
    }

    try {
      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' }
        });
      }

      const { city, state, game_type, max_results = 5 } = req.query;

      // Gather player context in parallel
      const [
        profileResult,
        preferencesResult,
        membershipsResult,
        sessionHistoryResult,
        groupsResult,
        upcomingGamesResult
      ] = await Promise.all([
        // 1. Player profile
        getSupabase()
          .from('profiles')
          .select('id, display_name, city, state')
          .eq('id', user.id)
          .maybeSingle(),

        // 2. Player preferences (all venues - general prefs)
        getSupabase()
          .from('commander_player_preferences')
          .select('preferred_games, preferred_stakes, auto_join_waitlist, notes')
          .eq('player_id', user.id)
          .limit(5),

        // 3. Existing group memberships (so we don't recommend groups they're in)
        getSupabase()
          .from('commander_home_members')
          .select('group_id, status, role')
          .eq('user_id', user.id)
          .in('status', ['approved', 'pending']),

        // 4. Recent session history (last 30 days, up to 20 sessions)
        getSupabase()
          .from('commander_player_sessions')
          .select('venue_id, check_in_at, total_buyin, total_time_minutes, games_played')
          .eq('player_id', user.id)
          .gte('check_in_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .order('check_in_at', { ascending: false })
          .limit(20),

        // 5. Public groups (exclude ones player is already in)
        fetchAvailableGroups({ city, state, game_type }),

        // 6. Upcoming home games with open seats
        fetchUpcomingGames({ city, state, game_type })
      ]);

      const profile = profileResult.data;
      const preferences = preferencesResult.data || [];
      const memberships = membershipsResult.data || [];
      const sessions = sessionHistoryResult.data || [];
      const availableGroups = groupsResult || [];
      const upcomingGames = upcomingGamesResult || [];

      // Filter out groups the player is already in
      const memberGroupIds = new Set(memberships.map(m => m.group_id));
      const newGroups = availableGroups.filter(g => !memberGroupIds.has(g.id));

      // Build player profile summary for Grok
      const playerContext = buildPlayerContext(profile, preferences, sessions);
      const groupContext = buildGroupContext(newGroups);
      const gameContext = buildGameContext(upcomingGames);

      // If no groups or games to match against, return empty
      if (newGroups.length === 0 && upcomingGames.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            matches: [],
            player_summary: playerContext.summary,
            message: 'No available groups or upcoming games found in your area. Try broadening your search.'
          }
        });
      }

      // Call Grok for intelligent matching
      const matches = await getGrokMatches(
        playerContext,
        groupContext,
        gameContext,
        parseInt(max_results) || 5
      );

      return res.status(200).json({
        success: true,
        data: {
          matches,
          player_summary: playerContext.summary,
          groups_considered: newGroups.length,
          games_considered: upcomingGames.length
        }
      });

    } catch (error) {
      console.warn('Matchmaker error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Matchmaker failed' }
      });
    }

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function fetchAvailableGroups({ city, state, game_type }) {
  let query = getSupabase()
    .from('commander_home_groups')
    .select(`
      id, name, description, city, state,
      default_game_type, default_stakes,
      typical_buyin_min, typical_buyin_max,
      max_players, typical_day, typical_time,
      frequency, member_count,
      profiles:owner_id (display_name)
    `)
    .eq('is_active', true)
    .eq('is_private', false)
    .order('member_count', { ascending: false })
    .limit(30);

  if (city) query = query.ilike('city', `%${escapeIlike(city)}%`);
  if (state) query = query.eq('state', state);
  if (game_type) query = query.eq('default_game_type', game_type);

  const { data, error } = await query;
  if (error) {
    console.warn('Fetch groups error:', error);
    return [];
  }
  return data || [];
}

async function fetchUpcomingGames({ city, state, game_type }) {
  const today = new Date().toISOString().split('T')[0];
  const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let query = getSupabase()
    .from('commander_home_games')
    .select(`
      id, title, game_type, stakes,
      buyin_min, buyin_max,
      scheduled_date, start_time,
      max_players, rsvp_yes, status,
      commander_home_groups!inner (
        id, name, city, state, is_private
      )
    `)
    .in('status', ['scheduled', 'confirmed'])
    .gte('scheduled_date', today)
    .lte('scheduled_date', twoWeeks)
    .order('scheduled_date', { ascending: true })
    .limit(30);

  if (game_type) query = query.eq('game_type', game_type);

  const { data, error } = await query;
  if (error) {
    console.warn('Fetch upcoming games error:', error);
    return [];
  }

  // Filter by location (group's city/state) and only public groups
  let games = (data || []).filter(g => !g.commander_home_groups?.is_private);

  if (city) {
    games = games.filter(g =>
      g.commander_home_groups?.city?.toLowerCase().includes(city.toLowerCase())
    );
  }
  if (state) {
    games = games.filter(g => g.commander_home_groups?.state === state);
  }

  // Only games with open seats
  games = games.filter(g => (g.rsvp_yes || 0) < (g.max_players || 9));

  return games;
}

function buildPlayerContext(profile, preferences, sessions) {
  // Aggregate preferences across venues
  const allGames = new Set();
  const allStakes = new Set();
  preferences.forEach(p => {
    (p.preferred_games || []).forEach(g => allGames.add(g));
    (p.preferred_stakes || []).forEach(s => allStakes.add(s));
  });

  // Analyze session patterns
  const sessionCount = sessions.length;
  const avgBuyin = sessionCount > 0
    ? Math.round(sessions.reduce((s, sess) => s + (sess.total_buyin || 0), 0) / sessionCount)
    : 0;
  const avgDuration = sessionCount > 0
    ? Math.round(sessions.reduce((s, sess) => s + (sess.total_time_minutes || 0), 0) / sessionCount)
    : 0;

  // Determine typical play times
  const playHours = sessions.map(s => new Date(s.check_in_at).getHours());
  const avgHour = playHours.length > 0
    ? Math.round(playHours.reduce((a, b) => a + b, 0) / playHours.length)
    : 19; // default evening
  const timePreference = avgHour < 12 ? 'morning' : avgHour < 17 ? 'afternoon' : 'evening';

  // Play frequency
  let frequency = 'unknown';
  if (sessionCount >= 15) frequency = 'frequent (4+ times/week)';
  else if (sessionCount >= 8) frequency = 'regular (2-3 times/week)';
  else if (sessionCount >= 4) frequency = 'weekly';
  else if (sessionCount >= 1) frequency = 'occasional';

  const summary = {
    location: profile ? `${profile.city || 'Unknown'}, ${profile.state || 'Unknown'}` : 'Unknown',
    preferred_games: Array.from(allGames),
    preferred_stakes: Array.from(allStakes),
    avg_buyin: avgBuyin,
    avg_session_minutes: avgDuration,
    time_preference: timePreference,
    play_frequency: frequency,
    sessions_last_30_days: sessionCount
  };

  return {
    summary,
    text: `Player from ${summary.location}. Prefers ${summary.preferred_games.join(', ') || 'any game'}` +
      ` at ${summary.preferred_stakes.join(', ') || 'any stakes'}.` +
      ` Average buy-in: $${avgBuyin}. Typical session: ${avgDuration} minutes.` +
      ` Plays ${frequency}, prefers ${timePreference} sessions.` +
      ` ${sessionCount} sessions in last 30 days.`
  };
}

function buildGroupContext(groups) {
  return groups.map(g => ({
    id: g.id,
    name: g.name,
    description: g.description || '',
    location: `${g.city || '?'}, ${g.state || '?'}`,
    game_type: g.default_game_type || 'nlhe',
    stakes: g.default_stakes || 'varies',
    buyin_range: g.typical_buyin_min && g.typical_buyin_max
      ? `$${g.typical_buyin_min}-$${g.typical_buyin_max}`
      : 'not specified',
    schedule: g.typical_day && g.typical_time
      ? `${g.typical_day}s at ${g.typical_time}`
      : g.frequency || 'irregular',
    members: g.member_count || 0,
    max_players: g.max_players || 9,
    host: g.profiles?.display_name || 'Unknown'
  }));
}

function buildGameContext(games) {
  return games.map(g => ({
    id: g.id,
    title: g.title || 'Untitled Game',
    group_name: g.commander_home_groups?.name || 'Unknown Group',
    group_id: g.commander_home_groups?.id,
    location: `${g.commander_home_groups?.city || '?'}, ${g.commander_home_groups?.state || '?'}`,
    game_type: g.game_type || 'nlhe',
    stakes: g.stakes || 'varies',
    buyin_range: g.buyin_min && g.buyin_max
      ? `$${g.buyin_min}-$${g.buyin_max}`
      : 'not specified',
    date: g.scheduled_date,
    time: g.start_time,
    seats_open: (g.max_players || 9) - (g.rsvp_yes || 0),
    max_players: g.max_players || 9,
    status: g.status
  }));
}

async function getGrokMatches(playerCtx, groups, games, maxResults) {
  const ai = getAIClient();

  const systemPrompt = `You are a poker home game matchmaker. Given a player's profile and available groups/games, rank the best matches.

Rules:
- Match on game type, stakes, buy-in range, location, schedule compatibility
- Prioritize upcoming games with open seats over groups (immediate value)
- Consider the player's typical session time and play frequency
- A player who plays $2/$5 would fit in a $1/$2-$2/$5 range group but not a $5/$10+ group
- Location match is important but not a dealbreaker
- Explain WHY each match is good in 1-2 sentences

Return ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "matches": [
    {
      "type": "game" or "group",
      "id": "the group or game UUID",
      "name": "group or game name",
      "score": 0-100,
      "reason": "1-2 sentence explanation of why this is a good match"
    }
  ]
}

Return up to ${maxResults} matches, sorted by score descending. If nothing is a reasonable match, return fewer or an empty array.`;

  const userMessage = `PLAYER PROFILE:
${playerCtx.text}

AVAILABLE GROUPS (${groups.length}):
${groups.length > 0 ? JSON.stringify(groups, null, 2) : 'None found.'}

UPCOMING GAMES WITH OPEN SEATS (${games.length}):
${games.length > 0 ? JSON.stringify(games, null, 2) : 'None found.'}

Find the best matches for this player.`;

  try {
    const completion = await ai.chat.completions.create({
      model: 'gpt-4o', // maps to grok-3 via grokClient
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 1500,
      temperature: 0.3
    });

    const raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw) return [];

    // Parse JSON, handling potential markdown wrapping
    let cleaned = raw;
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    const matches = parsed.matches || [];

    // Validate and enrich each match
    return matches
      .filter(m => m.id && m.type && m.score != null)
      .slice(0, maxResults)
      .map(m => ({
        type: m.type,
        id: m.id,
        name: m.name || 'Unknown',
        score: Math.min(100, Math.max(0, m.score)),
        reason: m.reason || ''
      }));

  } catch (err) {
    console.warn('Grok matchmaker error:', err);
    // Fallback: basic scoring without AI
    return fallbackMatching(playerCtx, groups, games, maxResults);
  }
}

/**
 * Rule-based fallback if Grok is unavailable
 */
function fallbackMatching(playerCtx, groups, games, maxResults) {
  const matches = [];
  const prefs = playerCtx.summary;

  // Score games first (immediate value)
  games.forEach(g => {
    let score = 50; // base

    // Game type match
    if (prefs.preferred_games.length === 0 || prefs.preferred_games.includes(g.game_type)) {
      score += 20;
    }

    // Stakes match
    if (prefs.preferred_stakes.length === 0 || prefs.preferred_stakes.includes(g.stakes)) {
      score += 15;
    }

    // Location match
    if (prefs.location.toLowerCase().includes(g.location.split(',')[0].trim().toLowerCase())) {
      score += 10;
    }

    // More open seats = better
    if (g.seats_open >= 3) score += 5;

    matches.push({
      type: 'game',
      id: g.id,
      name: `${g.title} (${g.group_name})`,
      score: Math.min(100, score),
      reason: `${g.game_type.toUpperCase()} game on ${g.date} with ${g.seats_open} open seats.`
    });
  });

  // Score groups
  groups.forEach(g => {
    let score = 40; // base (lower than games)

    if (prefs.preferred_games.length === 0 || prefs.preferred_games.includes(g.game_type)) {
      score += 20;
    }

    if (prefs.preferred_stakes.length === 0 || prefs.preferred_stakes.includes(g.stakes)) {
      score += 15;
    }

    if (prefs.location.toLowerCase().includes(g.location.split(',')[0].trim().toLowerCase())) {
      score += 10;
    }

    if (g.members >= 5) score += 5;

    matches.push({
      type: 'group',
      id: g.id,
      name: g.name,
      score: Math.min(100, score),
      reason: `${g.game_type.toUpperCase()} group in ${g.location} with ${g.members} members. Meets ${g.schedule}.`
    });
  });

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
