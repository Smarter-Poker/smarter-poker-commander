/**
 * Commander Must-Move API - POST/DELETE /api/commander/games/:id/must-move
 * Link or unlink must-move game relationships
 * POST: Set this game as a must-move that feeds into a main game
 * DELETE: Remove the must-move link
 * Reference: Phase 2 - Must-Move Games
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { verifyStaffSession } from '../../../../src/lib/commander/auth';
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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Game ID required' }
      });
    }

    switch (req.method) {
      case 'POST':
        return handlePost(req, res, id);
      case 'DELETE':
        return handleDelete(req, res, id);
      default:
        return res.status(405).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
        });
    }

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handlePost(req, res, gameId) {
  try {
    // Verify staff authentication
    const authResult = await verifyStaffSession(req);
    if (authResult.error) {
      return res.status(authResult.error.status).json({
        success: false,
        error: { code: authResult.error.code, message: authResult.error.message }
      });
    }

    const { parent_game_id } = req.body;

    if (!parent_game_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'parent_game_id (main game) is required' }
      });
    }

    // Verify this game exists and is active
    const { data: mustMoveGame, error: mmError } = await getSupabase()
      .from('commander_games')
      .select('id, venue_id, game_type, stakes, status, is_must_move, parent_game_id')
      .eq('id', gameId)
      .maybeSingle();

    if (mmError || !mustMoveGame) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Game not found' }
      });
    }

    if (!['waiting', 'running'].includes(mustMoveGame.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'GAME_CLOSED', message: 'Cannot link closed games' }
      });
    }

    if (mustMoveGame.is_must_move && mustMoveGame.parent_game_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_LINKED', message: 'This game is already a must-move game' }
      });
    }

    // Verify parent game exists, is compatible, and active
    const { data: mainGame, error: mainError } = await getSupabase()
      .from('commander_games')
      .select('id, venue_id, game_type, stakes, status, is_must_move')
      .eq('id', parent_game_id)
      .maybeSingle();

    if (mainError || !mainGame) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Parent game not found' }
      });
    }

    // Validate compatibility
    if (mainGame.venue_id !== mustMoveGame.venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'INCOMPATIBLE', message: 'Games must be at the same venue' }
      });
    }

    if (mainGame.game_type !== mustMoveGame.game_type || mainGame.stakes !== mustMoveGame.stakes) {
      return res.status(400).json({
        success: false,
        error: { code: 'INCOMPATIBLE', message: 'Games must have same type and stakes' }
      });
    }

    if (!['waiting', 'running'].includes(mainGame.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'GAME_CLOSED', message: 'Parent game is not active' }
      });
    }

    // Allow chaining: a must-move game CAN be used as a parent (e.g., T7 → T4 → T1).
    // But prevent circular chains (e.g., A → B → A).
    if (mainGame.is_must_move && mainGame.parent_game_id) {
      // Walk the chain to detect a cycle
      const visited = new Set([gameId, parent_game_id]);
      let currentId = mainGame.parent_game_id;
      let depth = 0;
      while (currentId && depth < 20) {
        if (visited.has(currentId)) {
          return res.status(400).json({
            success: false,
            error: { code: 'CIRCULAR_CHAIN', message: 'This would create a circular must-move chain' }
          });
        }
        visited.add(currentId);
        const { data: nextGame } = await getSupabase()
          .from('commander_games')
          .select('parent_game_id')
          .eq('id', currentId)
          .maybeSingle();
        currentId = nextGame?.parent_game_id || null;
        depth++;
      }
    }

    // Set this game as a must-move linked to the parent
    const { data: updated, error: updateError } = await getSupabase()
      .from('commander_games')
      .update({
        is_must_move: true,
        parent_game_id: parent_game_id
      })
      .eq('id', gameId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.warn('Must-move link error:', updateError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to link games' }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        game: updated,
        message: 'Game set as must-move successfully'
      }
    });
  } catch (error) {
    console.warn('Must-move POST error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handleDelete(req, res, gameId) {
  try {
    // Verify staff authentication
    const authResult = await verifyStaffSession(req);
    if (authResult.error) {
      return res.status(authResult.error.status).json({
        success: false,
        error: { code: authResult.error.code, message: authResult.error.message }
      });
    }

    // Verify game exists
    const { data: game, error: fetchError } = await getSupabase()
      .from('commander_games')
      .select('id, is_must_move, parent_game_id')
      .eq('id', gameId)
      .maybeSingle();

    if (fetchError || !game) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Game not found' }
      });
    }

    if (!game.is_must_move || !game.parent_game_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'NOT_LINKED', message: 'Game is not a must-move game' }
      });
    }

    // Remove the must-move link
    const { data: updated, error: updateError } = await getSupabase()
      .from('commander_games')
      .update({
        is_must_move: false,
        parent_game_id: null
      })
      .eq('id', gameId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.warn('Must-move unlink error:', updateError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to unlink games' }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        game: updated,
        message: 'Must-move link removed successfully'
      }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Must-move DELETE error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
