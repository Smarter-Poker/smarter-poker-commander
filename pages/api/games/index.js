/**
 * Commander Games API - POST /api/commander/games
 * Create a new game
 * Reference: API_REFERENCE.md - Games section
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

const VALID_GAME_TYPES = ['nlh', 'plo', 'plo5', 'mixed', 'limit', 'stud', 'razz', 'other'];

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    try {
      // Note: guardWriteStaff is already called in the main handler (line 23)
      // so staff auth is already validated. No need for a redundant check here.

      const {
        venue_id,
        table_id,
        game_type,
        stakes,
        min_buyin,
        max_buyin,
        max_players = 9,
        is_must_move = false,
        parent_game_id,
        settings = {}
      } = req.body;

      // Validation
      if (!venue_id || !game_type || !stakes) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'venue_id, game_type, and stakes are required'
          }
        });
      }

      if (!VALID_GAME_TYPES.includes(game_type.toLowerCase())) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid game_type. Must be one of: ${VALID_GAME_TYPES.join(', ')}`
          }
        });
      }

      // Verify venue exists and has Commander enabled
      const { data: venue, error: venueError } = await getSupabase()
        .from('poker_venues')
        .select('id, commander_enabled')
        .eq('id', venue_id)
        .maybeSingle();

      if (venueError || !venue) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Venue not found' }
        });
      }

      if (!venue.commander_enabled) {
        return res.status(400).json({
          success: false,
          error: { code: 'VENUE_NOT_COMMANDER', message: 'Venue is not using Commander' }
        });
      }

      // If table_id provided, verify table is available
      if (table_id) {
        const { data: table, error: tableError } = await getSupabase()
          .from('commander_tables')
          .select('id, status')
          .eq('id', table_id)
          .maybeSingle();

        if (tableError || !table) {
          return res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Table not found' }
          });
        }

        if (table.status !== 'available') {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Table is not available' }
          });
        }
      }

      // Create the game
      const { data: game, error: gameError } = await getSupabase()
        .from('commander_games')
        .insert({
          venue_id,
          table_id: table_id || null,
          game_type: game_type.toLowerCase(),
          stakes,
          min_buyin: min_buyin || null,
          max_buyin: max_buyin || null,
          max_players,
          is_must_move,
          parent_game_id: parent_game_id || null,
          settings,
          status: 'waiting',
          current_players: 0
        })
        .select()
        .maybeSingle();

      if (gameError) {
        console.warn('Commander game create error:', gameError);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to create game' }
        });
      }

      // Update table status if table was assigned
      if (table_id) {
        await getSupabase()
          .from('commander_tables')
          .update({
            status: 'in_use',
            current_game_id: game.id
          })
          .eq('id', table_id);
      }

      // Create empty seats for the game
      const seats = [];
      for (let i = 1; i <= max_players; i++) {
        seats.push({
          game_id: game.id,
          seat_number: i,
          status: 'empty'
        });
      }

      await getSupabase().from('commander_seats').insert(seats);

      return res.status(201).json({
        success: true,
        data: { game }
      });
    } catch (error) {
      console.warn('Commander games API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
