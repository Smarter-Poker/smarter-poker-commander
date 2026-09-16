/**
 * Commander Sessions API - GET/POST /api/commander/sessions
 * List sessions or check in a player
 * Reference: Phase 2 - Session Tracking
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { captureException } from '../../../src/lib/commander/errorMonitoring';
// 2026-07-25 audit fix: per-identity auth (staff session OR Bearer player) replaces
// guardWriteStaff, whose public GET returned venue-wide sessions to anyone.
import { verifyStaffSession, getUser } from '../../../src/lib/commander/auth';
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

    // 2026-07-25 audit fix: resolve identity - verified staff session first,
    // then authenticated player (Bearer/cookie). Anonymous callers get 401.
    const staffResult = await verifyStaffSession(req);
    const staff = staffResult.error ? null : staffResult.staff;
    const user = staff ? null : await getUser(req, res);

    if (!staff && !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication Required' }
      });
    }

    switch (req.method) {
      case 'GET':
        return handleGet(req, res, staff, user);
      case 'POST':
        return handlePost(req, res, staff, user);
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

async function handleGet(req, res, staff, user) {
  try {
    const { player_id, status = 'active', limit = 50 } = req.query;

    let query = getSupabase()
      .from('commander_player_sessions')
      .select(`
        *,
        profiles (
          id,
          display_name,
          avatar_url
        )
      `)
      .order('check_in_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 50, 500));

    // 2026-07-25 audit fix: scope by verified identity, never client input.
    if (staff) {
      // Staff see their own venue only (venue_id forced to the session's venue).
      query = query.eq('venue_id', staff.venue_id);
      if (player_id) {
        query = query.eq('player_id', player_id);
      }
    } else {
      // Authenticated player: their own sessions across venues, ignore client player_id.
      query = query.eq('player_id', user.id);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('Commander sessions query error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch sessions' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { sessions: data || [] }
    });
  } catch (error) {
    captureException(error, { action: 'sessions_list', endpoint: '/api/commander/sessions', venue_id: req.query?.venue_id });
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handlePost(req, res, staff, user) {
  try {
    let { venue_id, player_id, player_name } = req.body;
    // 2026-07-25 audit fix: allow authenticated player self-check-in when there
    // is no staff session (World Hub posts {venue_id, check_in_type:'self_service'}
    // with a Bearer token). Player identity comes from the verified token only.
    const isSelfService = !staff;

    if (!venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'venue_id is required' }
      });
    }

    if (isSelfService) {
      player_id = user.id; // ignore any client-supplied player_id
      player_name = null;

      // Validate the venue exists
      const { data: venue } = await getSupabase()
        .from('poker_venues')
        .select('id')
        .eq('id', venue_id)
        .maybeSingle();
      if (!venue) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Venue not found' }
        });
      }
    }

    if (!player_id && !player_name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Either player_id or player_name is required' }
      });
    }

    // Check if player already has an active session at this venue
    if (player_id) {
      const { data: existing } = await getSupabase()
        .from('commander_player_sessions')
        .select('id')
        .eq('venue_id', venue_id)
        .eq('player_id', player_id)
        .eq('status', 'active')
        .maybeSingle();

      if (existing) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Player already has an active session' }
        });
      }
    }

    const insertRow = {
      venue_id,
      player_id: player_id || null,
      player_name: player_name || null,
      status: 'active',
      check_in_at: new Date().toISOString()
    };
    // 2026-07-25 audit fix: tag self-service check-ins (metadata column exists; see waitlist XP flow)
    if (isSelfService) {
      insertRow.metadata = { check_in_type: 'self_service' };
    }

    const { data: session, error } = await getSupabase()
      .from('commander_player_sessions')
      .insert(insertRow)
      .select()
      .maybeSingle();

    if (error) {
      console.warn('Commander session create error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to create session' }
      });
    }

    return res.status(201).json({
      success: true,
      data: { session }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    captureException(error, { action: 'session_checkin', endpoint: '/api/commander/sessions', venue_id: req.body?.venue_id });
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
