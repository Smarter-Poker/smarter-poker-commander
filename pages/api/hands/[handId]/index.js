/**
 * Get Single Hand API
 * GET /api/commander/hands/[handId]
 * Per API_REFERENCE.md: /hands/:handId
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

    const { handId } = req.query;

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

      // Get hand with related data
      const { data: hand, error } = await getSupabase()
        .from('commander_hand_history')
        .select(`
          *,
          commander_games(id, game_type, stakes),
          commander_tables(
            id,
            table_number,
            poker_venues(id, name)
          )
        `)
        .eq('id', handId)
        .maybeSingle();

      if (error || !hand) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Hand not found' }
        });
      }

      // Format actions by street
      const actionsByStreet = {
        preflop: [],
        flop: [],
        turn: [],
        river: []
      };

      if (hand.actions) {
        hand.actions.forEach(action => {
          const street = action.street || 'preflop';
          if (actionsByStreet[street]) {
            actionsByStreet[street].push(action);
          }
        });
      }

      // 2026-07-25 audit fix: only participants of this hand's game may view
      // it — gate by the hand's player_seat_map or a seat record for the game.
      const inSeatMap = hand.player_seat_map &&
        typeof hand.player_seat_map === 'object' &&
        hand.player_seat_map[user.id] != null;
      if (!inSeatMap) {
        const gameId = hand.game_id || hand.commander_games?.id;
        let seatCount = 0;
        if (gameId) {
          const { count } = await getSupabase()
            .from('commander_seats')
            .select('id', { count: 'exact', head: true })
            .eq('game_id', gameId)
            .eq('player_id', user.id);
          seatCount = count || 0;
        }
        if (!seatCount) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You did not play in this game' }
          });
        }
      }

      // Determine player's seat strictly from player_seat_map.
      // 2026-07-25 audit fix: never fall back to the first seat's cards —
      // that leaked other players' hole cards.
      let playerSeat = null;
      let playerCards = [];

      if (inSeatMap && hand.player_cards && typeof hand.player_cards === 'object') {
        playerSeat = hand.player_seat_map[user.id];
        playerCards = hand.player_cards[playerSeat] || [];
      }

      // Determine winner info
      const winners = hand.winners || [];
      const isWinner = winners.some(
        w => (playerSeat != null && w.seat === playerSeat) || w.player_id === user.id
      );
      // 2026-07-25 audit fix: profit was fabricated (pot/2 or -pot/4) and
      // presented as real — actual per-player accounting is not available.
      const profit = null;
      const winningHand = winners[0]?.hand_name || null;

      // Format response
      const formattedHand = {
        id: hand.id,
        hand_number: hand.hand_number,
        game_type: `${hand.commander_games?.stakes || ''} ${hand.commander_games?.game_type || 'NLH'}`.trim(),
        venue_name: hand.commander_tables?.poker_venues?.name || 'Unknown Venue',
        player_seat: playerSeat,
        player_cards: playerCards,
        board: hand.board || [],
        pot_size: hand.pot_size || 0,
        profit: profit,
        result: isWinner ? 'won' : 'lost',
        winning_hand: winningHand,
        actions_by_street: actionsByStreet,
        rfid_captured: hand.rfid_captured,
        created_at: hand.created_at
      };

      return res.status(200).json({
        success: true,
        data: { hand: formattedHand }
      });

    } catch (error) {
      console.warn('Hand detail API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch hand' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
