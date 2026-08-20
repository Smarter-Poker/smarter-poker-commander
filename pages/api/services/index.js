/**
 * Commander Services API - GET/POST /api/commander/services
 * List or create service requests
 * Reference: Phase 2 - Service Requests
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
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

const VALID_REQUEST_TYPES = ['food', 'drink', 'chips', 'table_change', 'cashout', 'floor', 'other'];

// Auth: STAFF_WRITE - requires manager or owner role
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
    const { venue_id, game_id, status, limit = 50 } = req.query;

    let query = getSupabase()
      .from('commander_service_requests')
      .select(`
        *,
        commander_games (
          id,
          game_type,
          stakes,
          commander_tables!commander_games_table_id_fkey (
            table_number,
            table_name
          )
        ),
        commander_seats (
          seat_number
        )
      `)
      .order('created_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 50, 500));

    if (venue_id) {
      query = query.eq('venue_id', venue_id);
    }

    if (game_id) {
      query = query.eq('game_id', game_id);
    }

    if (status) {
      query = query.eq('status', status);
    } else {
      // Default to pending/acknowledged/in_progress
      query = query.in('status', ['pending', 'acknowledged', 'in_progress']);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('Commander services query error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch service requests' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { requests: data || [] }
    });
  } catch (error) {
    console.warn('Commander services GET error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handlePost(req, res) {
  try {
    const {
      venue_id,
      game_id,
      seat_id,
      player_id,
      request_type,
      details = {},
      notes,
      priority = 0
    } = req.body;

    if (!venue_id || !request_type) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'venue_id and request_type are required' }
      });
    }

    if (!VALID_REQUEST_TYPES.includes(request_type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Invalid request_type. Must be: ${VALID_REQUEST_TYPES.join(', ')}` }
      });
    }

    const { data: request, error } = await getSupabase()
      .from('commander_service_requests')
      .insert({
        venue_id,
        game_id: game_id || null,
        seat_id: seat_id || null,
        player_id: player_id || null,
        request_type,
        status: 'pending',
        details,
        notes,
        priority
      })
      .select()
      .maybeSingle();

    if (error) {
      console.warn('Commander service create error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to create service request' }
      });
    }

    return res.status(201).json({
      success: true,
      data: { request }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Commander services POST error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
