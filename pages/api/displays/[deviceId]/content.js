/**
 * Display Content API
 * GET /api/commander/displays/:deviceId/content
 * Returns content for table display based on current mode
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { parseBlindStructure } from '../../../../src/lib/parseBlindStructure';
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

    const { deviceId, screen } = req.query;

    try {
      // Get display config
      const { data: display, error: displayError } = await getSupabase()
        .from('commander_table_displays')
        .select('*, commander_tables(id, table_number, table_name)')
        .eq('device_id', deviceId)
        .maybeSingle();

      if (displayError || !display) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Display not registered' }
        });
      }

      // 2026-07-25 audit fix: removed the per-request last_heartbeat write —
      // the heartbeat endpoint owns online-status tracking.

      // Determine which screen to show
      const currentScreen = screen || display.display_mode;
      let content = {};

      switch (currentScreen) {
        case 'waitlist':
          content = await getWaitlistContent(display.venue_id);
          break;

        case 'clock':
          content = await getClockContent(display.venue_id);
          break;

        case 'promotions':
          content = await getPromotionsContent(display.venue_id);
          break;

        case 'high_hand':
          content = await getHighHandContent(display.venue_id);
          break;

        case 'leaderboard':
          content = await getLeaderboardContent(display.venue_id);
          break;

        case 'rotation':
        default:
          // Get all content for rotation
          content = {
            waitlist: await getWaitlistContent(display.venue_id),
            promotions: await getPromotionsContent(display.venue_id),
            high_hand: await getHighHandContent(display.venue_id),
            leaderboard: await getLeaderboardContent(display.venue_id)
          };
          break;
      }

      return res.status(200).json({
        success: true,
        data: {
          display_id: display.id,
          screen: currentScreen,
          rotation_screens: display.rotation_screens,
          rotation_interval: display.rotation_interval,
          venue_id: display.venue_id,
          table: display.commander_tables,
          content,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.warn('Display content error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch content' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// 2026-07-25 audit fix: this is a public TV endpoint — redact player names to
// "First L." so full names are never shown on shared displays.
function redactName(name) {
  if (!name || typeof name !== 'string' || !name.trim()) return 'Player';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

async function getWaitlistContent(venueId) {
  // Get active games with waitlists
  const { data: games } = await getSupabase()
    .from('commander_games')
    .select('id, game_type, stakes, current_players, max_players, status')
    .eq('venue_id', venueId)
    .in('status', ['waiting', 'running'])
    .order('game_type')
        .limit(100)

  // Get waitlist entries grouped by game
  const { data: waitlist } = await getSupabase()
    .from('commander_waitlist')
    .select('id, game_type, stakes, player_name, position, status, estimated_wait_minutes, created_at')
    .eq('venue_id', venueId)
    .eq('status', 'waiting')
    .order('position')

  // Group waitlist by game type + stakes
  const waitlistByGame = {};
  (waitlist || []).forEach(entry => {
    const key = `${entry.game_type}-${entry.stakes}`;
    if (!waitlistByGame[key]) {
      waitlistByGame[key] = [];
    }
    waitlistByGame[key].push({
      position: entry.position,
      // 2026-07-25 audit fix: redacted for public display
      name: redactName(entry.player_name),
      wait_minutes: entry.estimated_wait_minutes
    });
  });

  return {
    games: games || [],
    waitlist: waitlistByGame,
    total_waiting: (waitlist || []).length
  };
}

async function getClockContent(venueId) {
  // Get running tournament
  const { data: tournament } = await getSupabase()
    .from('commander_tournaments')
    .select('*')
    .eq('venue_id', venueId)
    .in('status', ['running', 'paused', 'final_table'])
    .order('actual_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tournament) {
    return { active: false };
  }

  return {
    active: true,
    tournament_name: tournament.name,
    status: tournament.status,
    current_level: tournament.current_level,
    blind_structure: parseBlindStructure(tournament.blind_structure),
    is_on_break: tournament.is_on_break,
    players_remaining: tournament.players_remaining,
    total_entries: tournament.total_entries,
    prize_pool: tournament.prize_pool,
    average_stack: tournament.average_stack
  };
}

async function getPromotionsContent(venueId) {
  const now = new Date().toISOString();

  const { data: promotions } = await getSupabase()
    .from('commander_promotions')
    .select('id, name, description, promotion_type, prize_type, prize_amount, starts_at, ends_at')
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .limit(5);

  // Get progressive jackpots
  const { data: jackpots } = await getSupabase()
    .from('commander_progressive_jackpots')
    .select('id, name, current_amount, min_qualifying_hand')
    .eq('venue_id', venueId)
    .eq('status', 'active');

  return {
    promotions: promotions || [],
    jackpots: jackpots || []
  };
}

async function getHighHandContent(venueId) {
  const today = new Date().toISOString().split('T')[0];

  // Get today's high hands
  const { data: highHands } = await getSupabase()
    .from('commander_high_hands')
    .select('id, player_name, hand_description, hand_cards, prize_amount, verified_at, table_number')
    .eq('venue_id', venueId)
    .gte('created_at', today)
    .not('verified_at', 'is', null)
    .order('hand_rank', { ascending: false })
    .limit(10);

  // 2026-07-25 audit fix: redact player names for public display
  const redactedHands = (highHands || []).map(h => ({
    ...h,
    player_name: redactName(h.player_name)
  }));

  // Get current high hand (best of day)
  const currentHigh = redactedHands[0] || null;

  return {
    current_high: currentHigh,
    todays_winners: redactedHands,
    last_updated: new Date().toISOString()
  };
}

async function getLeaderboardContent(venueId) {
  // Get active leaderboard
  const { data: leaderboard } = await getSupabase()
    .from('commander_leaderboards')
    .select('id, name, period_type, prize_pool')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!leaderboard) {
    return { active: false };
  }

  // Get top entries
  const { data: entries } = await getSupabase()
    .from('commander_leaderboard_entries')
    .select(`
      id,
      points,
      rank,
      profiles!inner (
        id,
        username,
        avatar_url
      )
    `)
    .eq('leaderboard_id', leaderboard.id)
    .order('points', { ascending: false })
    .limit(10);

  return {
    active: true,
    leaderboard_name: leaderboard.name,
    period: leaderboard.period_type,
    prize_pool: leaderboard.prize_pool,
    top_players: (entries || []).map((e, i) => ({
      rank: i + 1,
      // 2026-07-25 audit fix: redacted for public display
      name: redactName(e.profiles?.username),
      points: e.points,
      avatar: e.profiles?.avatar_url
    }))
  };
}
