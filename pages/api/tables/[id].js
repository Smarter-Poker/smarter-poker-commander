/**
 * Commander Table API - GET/PATCH/DELETE /api/commander/tables/:id
 * Get, update, or delete a table
 * Reference: Phase 2 - Table CRUD
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { verifyStaffSession } from '../../../src/lib/commander/auth';
import { logAction, AuditActions } from '../../../src/lib/commander/audit';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

const VALID_STATUSES = ['available', 'in_use', 'reserved', 'maintenance'];

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Table ID required' }
      });
    }

    switch (req.method) {
      case 'GET':
        return handleGet(req, res, id);
      case 'PATCH':
        return handlePatch(req, res, id);
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

async function handleGet(req, res, tableId) {
  try {
    // Verify staff authentication
    const authResult = await verifyStaffSession(req);
    if (authResult.error) {
      return res.status(authResult.error.status).json({
        success: false,
        error: { code: authResult.error.code, message: authResult.error.message }
      });
    }

    const { data: table, error } = await getSupabase()
      .from('commander_tables')
      .select(`
        *,
        commander_games!commander_games_table_id_fkey (
          id,
          game_type,
          stakes,
          status,
          current_players,
          max_players,
          started_at,
          commander_seats (
            id,
            seat_number,
            player_name,
            status,
            seated_at
          )
        )
      `)
      .eq('id', tableId)
      .maybeSingle();

    if (error || !table) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Table not found' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { table }
    });
  } catch (error) {
    console.warn('Commander table GET error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handlePatch(req, res, tableId) {
  try {
    // Verify staff authentication
    const authResult = await verifyStaffSession(req);
    if (authResult.error) {
      return res.status(authResult.error.status).json({
        success: false,
        error: { code: authResult.error.code, message: authResult.error.message }
      });
    }

    const { table_name, max_seats, status, features, position_x, position_y, rotation, game_type, stakes, table_purpose, mode } = req.body;

    // Verify table exists
    const { data: existing, error: fetchError } = await getSupabase()
      .from('commander_tables')
      .select('id, status, current_game_id')
      .eq('id', tableId)
      .maybeSingle();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Table not found' }
      });
    }

    const updates = {};

    if (table_name !== undefined) updates.table_name = table_name;
    if (max_seats !== undefined) updates.max_seats = max_seats;
    if (features !== undefined) updates.features = features;
    if (position_x !== undefined) updates.position_x = position_x;
    if (position_y !== undefined) updates.position_y = position_y;
    if (rotation !== undefined) updates.rotation = rotation;
    if (game_type !== undefined) updates.game_type = game_type;
    if (stakes !== undefined) updates.stakes = stakes;
    if (table_purpose !== undefined) updates.table_purpose = table_purpose;
    if (mode !== undefined) updates.mode = mode;
    // Bidirectional sync: table_purpose ↔ mode
    // If table_purpose is set but mode is not, derive mode from table_purpose
    if (table_purpose !== undefined && mode === undefined) {
      updates.mode = table_purpose === 'tournament' ? 'tournament' : 'cash';
    }
    // If mode is set but table_purpose is not, derive table_purpose from mode
    if (mode !== undefined && table_purpose === undefined) {
      updates.table_purpose = mode === 'tournament' ? 'tournament' : mode === 'cash' ? 'cash_game' : null;
    }

    // ═══════════════════════════════════════════════════════════════════
    // CRITICAL RULE: A tournament can NEVER be a cash game, and a cash
    // game can NEVER be a tournament. Block mode changes when an active
    // game of the opposite type exists on this table.
    // ═══════════════════════════════════════════════════════════════════
    const newMode = updates.mode || updates.table_purpose;
    if (newMode) {
      // Fetch the table's current mode and check for active games
      const { data: tableWithGames } = await getSupabase()
        .from('commander_tables')
        .select(`
          mode, table_purpose,
          commander_games!commander_games_table_id_fkey (id, status, game_type, stakes)
        `)
        .eq('id', tableId)
        .maybeSingle();

      if (tableWithGames) {
        const currentMode = tableWithGames.mode || tableWithGames.table_purpose || 'cash';
        const activeGames = (tableWithGames.commander_games || []).filter(
          g => ['running', 'waiting', 'breaking'].includes(g.status)
        );

        // Switching from cash → tournament while cash game is active
        if (currentMode !== 'tournament' && (newMode === 'tournament') && activeGames.length > 0) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'MODE_CONFLICT',
              message: `Cannot Switch To Tournament Mode, Table Has ${activeGames.length} Active Cash Game(s). Close All Games First.`
            }
          });
        }

        // Switching from tournament → cash while tournament game is active
        if (currentMode === 'tournament' && (newMode === 'cash' || newMode === 'cash_game') && activeGames.length > 0) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'MODE_CONFLICT',
              message: `Cannot Switch To Cash Mode, Table Has ${activeGames.length} Active Tournament Game(s). Close All Games First.`
            }
          });
        }
      }
    }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid status. Must be: ${VALID_STATUSES.join(', ')}` }
        });
      }
      // Can't change to available if game is running
      if (status === 'available' && existing.current_game_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Cannot set to available while game is running' }
        });
      }
      updates.status = status;
    }

    if (Object.keys(updates || {}).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' }
      });
    }

    const { data: table, error: updateError } = await getSupabase()
      .from('commander_tables')
      .update(updates)
      .eq('id', tableId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.warn('Commander table PATCH error:', updateError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to update table' }
      });
    }

    // Audit log
    if (authResult.staff?.id) {
      await logAction(AuditActions.TABLE_UPDATE, {
        venueId: table.venue_id || authResult.staff.venue_id,
        staffId: authResult.staff.id,
        targetId: tableId,
        targetType: 'commander_tables',
        targetName: updates.table_name || `Table ${table.table_number || tableId}`,
        changes: updates,
        req
      });
    }

    return res.status(200).json({
      success: true,
      data: { table }
    });
  } catch (error) {
    console.warn('Commander table PATCH error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handleDelete(req, res, tableId) {
  try {
    // Verify staff authentication
    const authResult = await verifyStaffSession(req);
    if (authResult.error) {
      return res.status(authResult.error.status).json({
        success: false,
        error: { code: authResult.error.code, message: authResult.error.message }
      });
    }

    // Verify table exists and is not in use
    const { data: table, error: fetchError } = await getSupabase()
      .from('commander_tables')
      .select('id, status, current_game_id, table_number, venue_id')
      .eq('id', tableId)
      .maybeSingle();

    if (fetchError || !table) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Table not found' }
      });
    }

    if (table.current_game_id || table.status === 'in_use') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Cannot delete table while game is running' }
      });
    }

    const { error: deleteError } = await getSupabase()
      .from('commander_tables')
      .delete()
      .eq('id', tableId);

    if (deleteError) {
      console.warn('Commander table DELETE error:', deleteError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to delete table' }
      });
    }

    // Audit log
    if (authResult.staff?.id) {
      await logAction(AuditActions.TABLE_DELETE, {
        venueId: table.venue_id,
        staffId: authResult.staff.id,
        targetId: tableId,
        targetType: 'commander_tables',
        targetName: `Table ${table.table_number}`,
        req
      });
    }

    return res.status(200).json({
      success: true,
      data: { message: 'Table deleted successfully' }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Commander table DELETE error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
