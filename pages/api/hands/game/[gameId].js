/**
 * Get Hands from Game API
 * GET /api/commander/hands/game/[gameId]
 * Per API_REFERENCE.md: /hands/:gameId
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

    const { gameId, limit = 50, offset = 0 } = req.query;

    // Require authentication
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
          error: { code: 'AUTH_REQUIRED', message: 'Invalid token' }
        });
      }

      // Get game info
      const { data: game, error: gameError } = await getSupabase()
        .from('commander_games')
        .select('id, game_type, stakes')
        .eq('id', gameId)
        .maybeSingle();

      if (gameError || !game) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Game not found' }
        });
      }

      // Get hands from this game
      const { data: hands, error } = await getSupabase()
        .from('commander_hand_history')
        .select('*')
        .eq('game_id', gameId)
        .order('hand_number', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      if (error) {
        console.warn('Hands error:', error);
        throw error;
      }

      // 2026-07-25 audit fix: only participants of this game may read its hand
      // list — gate by presence in any hand's player_seat_map or a seat record.
      const inAnySeatMap = (hands || []).some(
        h => h.player_seat_map && typeof h.player_seat_map === 'object' && h.player_seat_map[user.id] != null
      );
      if (!inAnySeatMap) {
        const { count: seatCount } = await getSupabase()
          .from('commander_seats')
          .select('id', { count: 'exact', head: true })
          .eq('game_id', gameId)
          .eq('player_id', user.id);
        if (!seatCount) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You did not play in this game' }
          });
        }
      }

      // Format hands for player view
      const formattedHands = hands?.map(hand => {
        // Determine player's seat and cards strictly from player_seat_map.
        // 2026-07-25 audit fix: never fall back to the first seat's cards —
        // that leaked other players' hole cards.
        let playerSeat = null;
        let playerCards = [];

        if (
          hand.player_cards && typeof hand.player_cards === 'object' &&
          hand.player_seat_map && typeof hand.player_seat_map === 'object' &&
          hand.player_seat_map[user.id] != null
        ) {
          playerSeat = hand.player_seat_map[user.id];
          playerCards = hand.player_cards[playerSeat] || [];
        }

        const winners = hand.winners || [];
        const isWinner = winners.some(
          w => (playerSeat != null && w.seat === playerSeat) || w.player_id === user.id
        );
        // 2026-07-25 audit fix: profit was fabricated (pot/2 or -pot/4) and
        // presented as real — actual per-player accounting is not available.
        const profit = null;

        return {
          id: hand.id,
          hand_number: hand.hand_number,
          game_type: `${game.stakes || ''} ${game.game_type || 'NLH'}`.trim(),
          player_seat: playerSeat,
          player_cards: playerCards,
          board: hand.board || [],
          pot_size: hand.pot_size || 0,
          profit: profit,
          result: isWinner ? 'won' : 'lost',
          created_at: hand.created_at
        };
      }) || [];

      return res.status(200).json({
        success: true,
        data: {
          hands: formattedHands,
          total: hands?.length || 0
        }
      });

    } catch (error) {
      console.warn('Hands API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch hands' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
