/**
 * Commander Session API - GET/PATCH /api/commander/sessions/:id
 * Get or update a session (checkout)
 * Reference: Phase 2 - Session Tracking
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // 2026-08-20 audit fix: was guardWriteStaff, which returns `true` for GET
    // without verifying anything - a session id leaked the player's identity,
    // buy-in totals and staff notes. The PATCH path (checkout / abandon /
    // buy-in edits) had no venue ownership check at all, so any staff member
    // could close out another venue's player sessions.
    const _authResult = await guardStaff(req, res);
    if (!_authResult) return;

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Session ID required' }
      });
    }

    const { data: owner } = await getSupabase()
      .from('commander_player_sessions')
      .select('id, venue_id')
      .eq('id', id)
      .maybeSingle();

    if (!owner) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session Not Found' }
      });
    }

    if (_authResult.venue_id !== undefined && _authResult.venue_id !== null
        && String(owner.venue_id) !== String(_authResult.venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' }
      });
    }

    switch (req.method) {
      case 'GET':
        return handleGet(req, res, id);
      case 'PATCH':
        return handlePatch(req, res, id);
      default:
        return res.status(405).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
        });
    }

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleGet(req, res, sessionId) {
  try {
    const { data: session, error } = await getSupabase()
      .from('commander_player_sessions')
      .select(`
        *,
        profiles (
          id,
          display_name,
          avatar_url
        )
      `)
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !session) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { session }
    });
  } catch (error) {
    console.warn('Commander session GET error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handlePatch(req, res, sessionId) {
  try {
    const { action, games_played, total_buyin, comps_earned, notes } = req.body;

    // Get current session
    const { data: session, error: fetchError } = await getSupabase()
      .from('commander_player_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (fetchError || !session) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found' }
      });
    }

    const updates = {};

    // Handle checkout action
    if (action === 'checkout') {
      if (session.check_out_at) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Session already checked out' }
        });
      }

      const checkoutTime = new Date();
      const checkInTime = new Date(session.check_in_at);
      const totalMinutes = Math.round((checkoutTime - checkInTime) / (1000 * 60));
      const hoursPlayed = Math.floor(totalMinutes / 60);

      updates.check_out_at = checkoutTime.toISOString();
      updates.total_time_minutes = totalMinutes;

      // Award XP for session completion - stored in metadata JSONB
      // 50 XP base + 10 XP per hour played
      if (session.player_id && totalMinutes >= 30) {
        const XP_FOR_SESSION_COMPLETE = 50;
        const XP_PER_HOUR = 10;
        const bonusXP = XP_FOR_SESSION_COMPLETE + (hoursPlayed * XP_PER_HOUR);
        const currentMetadata = session.metadata || {};

        updates.metadata = {
          ...currentMetadata,
          xp_earned: (currentMetadata.xp_earned || 0) + bonusXP
        };
      }
    }

    // Handle abandon action
    if (action === 'abandon') {
      updates.status = 'abandoned';
      updates.check_out_at = new Date().toISOString();
    }

    // Update stats
    if (games_played !== undefined) updates.games_played = games_played;
    if (total_buyin !== undefined) updates.total_buyin = total_buyin;
    if (comps_earned !== undefined) updates.comps_earned = comps_earned;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates || {}).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' }
      });
    }

    const { data: updated, error: updateError } = await getSupabase()
      .from('commander_player_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.warn('Commander session PATCH error:', updateError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to update session' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { session: updated }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Commander session PATCH error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
