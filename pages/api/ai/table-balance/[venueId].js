/**
 * AI Table Balance Suggestions API
 * GET /api/commander/ai/table-balance/[venueId]
 * Returns suggestions for balancing tables
 * Per API_REFERENCE.md
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { requireStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';

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

    // Require floor staff or higher for table balance suggestions
    const staff = await requireStaff(req, res, venueId, ['owner', 'manager', 'floor']);
    if (!staff) return;

    try {
      // Get all running games at this venue
      const { data: games, error: gamesError } = await getSupabase()
        .from('commander_games')
        .select(`
          id,
          table_id,
          game_type,
          stakes,
          current_players,
          max_players,
          started_at,
          commander_tables!commander_games_table_id_fkey (
            table_number,
            table_name
          )
        `)
        .eq('venue_id', venueId)
        .eq('status', 'running');

      if (gamesError) {
        console.warn('Games fetch error:', gamesError);
        throw gamesError;
      }

      // Get seats for each game
      const gameIds = (games || []).map(g => g.id);
      const { data: seats, error: seatsError } = await getSupabase()
        .from('commander_seats')
        .select('game_id, seat_number, player_id, player_name, seated_at, status')
        .in('game_id', gameIds.length > 0 ? gameIds : ['none'])
        .eq('status', 'occupied')
            .limit(100)

      if (seatsError) {
        console.warn('Seats fetch error:', seatsError);
      }

      // Group games by type and stakes
      const gameGroups = {};
      (games || []).forEach(game => {
        const key = `${game.game_type}_${game.stakes}`;
        if (!gameGroups[key]) {
          gameGroups[key] = [];
        }

        // Get seats for this game
        const gameSeats = (seats || []).filter(s => s.game_id === game.id);

        gameGroups[key].push({
          ...game,
          table_number: game.commander_tables?.table_number || 'Unknown',
          table_name: game.commander_tables?.table_name,
          occupiedSeats: gameSeats,
          playerCount: gameSeats.length
        });
      });

      // Generate balance suggestions
      const suggestions = [];

      Object.entries(gameGroups || {}).forEach(([key, tables]) => {
        if (tables.length < 2) return; // Need at least 2 tables to balance

        // Sort by player count
        tables.sort((a, b) => b.playerCount - a.playerCount);

        const maxTable = tables[0];
        const minTable = tables[tables.length - 1];

        // If difference is 2+ players, suggest balancing
        const diff = maxTable.playerCount - minTable.playerCount;

        if (diff >= 2) {
          // Find a player to move (prefer most recently seated)
          const playersToMove = maxTable.occupiedSeats
            .sort((a, b) => new Date(b.seated_at) - new Date(a.seated_at));

          if (playersToMove.length > 0) {
            const playerToMove = playersToMove[0];

            suggestions.push({
              fromTable: {
                id: maxTable.table_id,
                number: maxTable.table_number,
                name: maxTable.table_name,
                current_players: maxTable.playerCount
              },
              toTable: {
                id: minTable.table_id,
                number: minTable.table_number,
                name: minTable.table_name,
                current_players: minTable.playerCount
              },
              player: {
                id: playerToMove.player_id,
                name: playerToMove.player_name || 'Player',
                seat: playerToMove.seat_number,
                time_at_table: Math.round((Date.now() - new Date(playerToMove.seated_at).getTime()) / 60000)
              },
              reason: `Balance ${key.replace('_', ' ')} tables (${maxTable.playerCount} vs ${minTable.playerCount} players)`,
              priority: diff >= 3 ? 'high' : 'medium',
              game_type: tables[0].game_type,
              stakes: tables[0].stakes
            });
          }
        }
      });

      // Sort suggestions by priority
      suggestions.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      return res.status(200).json({
        success: true,
        data: {
          suggestions,
          table_summary: Object.entries(gameGroups || {}).map(([key, tables]) => ({
            game: key,
            tables: tables.map(t => ({
              table_number: t.table_number,
              players: t.playerCount,
              max: t.max_players
            }))
          })),
          generated_at: new Date().toISOString()
        }
      });

    } catch (error) {
      console.warn('Table balance error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to generate suggestions' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
