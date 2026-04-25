/**
 * Commander Sessions API - GET/POST /api/commander/sessions
 * List sessions or check in a player
 * Reference: Phase 2 - Session Tracking
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { captureException } from '../../../src/lib/commander/errorMonitoring';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
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

async function handleGet(req, res) {
  try {
    const { venue_id, player_id, status = 'active', limit = 50 } = req.query;

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

    if (venue_id) {
      query = query.eq('venue_id', venue_id);
    }

    if (player_id) {
      query = query.eq('player_id', player_id);
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

async function handlePost(req, res) {
  try {
    const { venue_id, player_id, player_name } = req.body;

    if (!venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'venue_id is required' }
      });
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

    const { data: session, error } = await getSupabase()
      .from('commander_player_sessions')
      .insert({
        venue_id,
        player_id: player_id || null,
        player_name: player_name || null,
        status: 'active',
        check_in_at: new Date().toISOString()
      })
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
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    captureException(error, { action: 'session_checkin', endpoint: '/api/commander/sessions', venue_id: req.body?.venue_id });
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
