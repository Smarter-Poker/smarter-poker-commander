/**
 * Commander Seat Player API - POST /api/commander/waitlist/:id/seat [Staff]
 * Seat a player from the waitlist
 * Reference: API_REFERENCE.md - Waitlist section
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { logAction, AuditActions } from '../../../../src/lib/commander/audit';
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

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Waitlist entry ID required' }
      });
    }

    try {
      const staff = _staff; // from guardStaff

      const { game_id, seat_number, buyin_amount } = req.body;

      // Validation
      if (!game_id || !seat_number) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'game_id and seat_number are required'
          }
        });
      }

      // Verify entry exists and is waiting/called
      const { data: entry, error: fetchError } = await getSupabase()
        .from('commander_waitlist')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchError || !entry) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Waitlist entry not found' }
        });
      }

      if (!['waiting', 'called'].includes(entry.status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Entry is not eligible to be seated' }
        });
      }

      // Verify staff belongs to the same venue as the waitlist entry
      if (staff.venue_id !== entry.venue_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Staff is not authorized for this venue' }
        });
      }

      // Verify game exists and is running
      const { data: game, error: gameError } = await getSupabase()
        .from('commander_games')
        .select('id, status, venue_id, current_players')
        .eq('id', game_id)
        .maybeSingle();

      if (gameError || !game) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Game not found' }
        });
      }

      if (!['waiting', 'running'].includes(game.status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'GAME_CLOSED', message: 'Game is not available for seating' }
        });
      }

      // Verify seat is available
      const { data: existingSeat, error: seatError } = await getSupabase()
        .from('commander_seats')
        .select('id, status')
        .eq('game_id', game_id)
        .eq('seat_number', seat_number)
        .maybeSingle();

      if (seatError || !existingSeat) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Seat not found' }
        });
      }

      if (existingSeat.status !== 'empty') {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Seat is not available' }
        });
      }

      const now = new Date().toISOString();

      // Update seat to occupied
      const { error: seatUpdateError } = await getSupabase()
        .from('commander_seats')
        .update({
          player_id: entry.player_id || null,
          player_name: entry.player_name || 'Player',
          status: 'occupied',
          buyin_amount: buyin_amount || null,
          seated_at: now
        })
        .eq('id', existingSeat.id);

      if (seatUpdateError) {
        console.warn('Commander seat update error:', seatUpdateError);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to update seat' }
        });
      }

      // Update waitlist entry to seated
      const { data: updatedEntry, error: entryUpdateError } = await getSupabase()
        .from('commander_waitlist')
        .update({
          status: 'seated',
          seated_at: now
        })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (entryUpdateError) {
        console.warn('Commander waitlist update error:', entryUpdateError);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to update waitlist entry' }
        });
      }

      // Update game player count and status
      const gameUpdates = {
        current_players: (game.current_players || 0) + 1
      };
      if (game.status === 'waiting') {
        gameUpdates.status = 'running';
        gameUpdates.started_at = now;
      }
      const { error: gameUpdateError } = await getSupabase()
        .from('commander_games')
        .update(gameUpdates)
        .eq('id', game_id);

      if (gameUpdateError) {
        console.warn('Commander game update error:', gameUpdateError);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to update game' }
        });
      }

      // Calculate wait time and log to history
      const waitTimeMinutes = Math.round(
        (new Date(now) - new Date(entry.created_at)) / (1000 * 60)
      );

      await getSupabase()
        .from('commander_waitlist_history')
        .insert({
          venue_id: entry.venue_id,
          player_id: entry.player_id || null,
          game_type: entry.game_type,
          stakes: entry.stakes,
          wait_time_minutes: waitTimeMinutes,
          was_seated: true,
          signup_method: entry.signup_method
        });

      // Award XP to player for getting seated - stored in metadata JSONB
      if (entry.player_id) {
        const XP_FOR_SEATED = 25; // Base XP for getting seated
        const DIAMOND_FOR_SEATED = 1; // Bonus diamond for using Commander

        // Create or update player session
        const { data: existingSession } = await getSupabase()
          .from('commander_player_sessions')
          .select('id, metadata')
          .eq('venue_id', entry.venue_id)
          .eq('player_id', entry.player_id)
          .is('check_out_at', null)
          .maybeSingle();

        if (existingSession) {
          // Update existing session with XP in metadata
          const currentMetadata = existingSession.metadata || {};
          await getSupabase()
            .from('commander_player_sessions')
            .update({
              games_played: (existingSession.games_played || 0) + 1,
              metadata: {
                ...currentMetadata,
                xp_earned: (currentMetadata.xp_earned || 0) + XP_FOR_SEATED,
                diamonds_earned: (currentMetadata.diamonds_earned || 0) + DIAMOND_FOR_SEATED
              }
            })
            .eq('id', existingSession.id);
        } else {
          // Create new session with XP in metadata
          await getSupabase()
            .from('commander_player_sessions')
            .insert({
              venue_id: entry.venue_id,
              player_id: entry.player_id,
              check_in_at: now,
              games_played: 1,
              metadata: {
                xp_earned: XP_FOR_SEATED,
                diamonds_earned: DIAMOND_FOR_SEATED
              }
            });
        }
      }

      // Audit log
      await logAction(AuditActions.WAITLIST_SEAT, {
        venueId: staff.venue_id,
        staffId: staff.id,
        targetId: id,
        targetType: 'commander_waitlist',
        targetName: entry.player_name || 'Player',
        metadata: { game_id, seat_number, buyin_amount },
        req
      });

      return res.status(200).json({
        success: true,
        data: {
          entry: updatedEntry,
          seat_number,
          game_id,
          wait_time_minutes: waitTimeMinutes
        }
      });
    } catch (error) {
      console.warn('Commander waitlist seat API error:', error);
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
