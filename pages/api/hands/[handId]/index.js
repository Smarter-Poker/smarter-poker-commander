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

      // Determine player's seat from player_cards or session
      let playerSeat = null;
      let playerCards = [];

      if (hand.player_cards && typeof hand.player_cards === 'object') {
        // player_cards is an object with seat numbers as keys
        // Find the seat for the current user
        const seats = Object.keys(hand.player_cards || {});
        if (seats.length > 0) {
          // If we have player_seat_map, use it to find user's seat
          if (hand.player_seat_map && hand.player_seat_map[user.id]) {
            playerSeat = hand.player_seat_map[user.id];
            playerCards = hand.player_cards[playerSeat] || [];
          } else {
            // Fallback: use the first seat with cards (for single-player view)
            playerSeat = parseInt(seats[0]) || 1;
            playerCards = hand.player_cards[seats[0]] || [];
          }
        }
      }

      // Determine winner info
      const winners = hand.winners || [];
      const isWinner = winners.some(w => w.seat === playerSeat || w.player_id === user.id);
      const profit = isWinner ? Math.round(hand.pot_size / 2) : -Math.round(hand.pot_size / 4);
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
