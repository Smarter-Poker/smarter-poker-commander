/**
 * Commander Service Request API - GET/PATCH /api/commander/services/:id
 * Get or update a service request
 * Reference: Phase 2 - Service Requests
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff, guardUser } from '../../../src/lib/commander/auth';
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

const VALID_STATUSES = ['pending', 'acknowledged', 'in_progress', 'completed', 'cancelled'];

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Request ID required' }
      });
    }

    switch (req.method) {
      case 'GET':
        return handleGet(req, res, id);
      case 'PATCH': {
        // 2026-07-25 audit fix: use the staff object resolved by the guard —
        // the old handlePatch re-queried commander_staff by sessionData.id,
        // which is undefined for owner sessions.
        const staff = await guardStaff(req, res);
        if (!staff) return;
        return handlePatch(req, res, id, staff);
      }
      case 'DELETE':
        // 2026-07-25 audit fix: allow the requesting player to cancel their
        // own service request (Bearer user), as the player UI expects.
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

async function handleGet(req, res, requestId) {
  try {
    const { data: request, error } = await getSupabase()
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
        ),
        commander_staff (
          id,
          role,
          profiles (
            display_name
          )
        )
      `)
      .eq('id', requestId)
      .maybeSingle();

    if (error || !request) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Service request not found' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { request }
    });
  } catch (error) {
    console.warn('Commander service GET error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handlePatch(req, res, requestId, staff) {
  try {
    // 2026-07-25 audit fix: staff is the verified object from guardStaff —
    // no re-query by sessionData.id (undefined for owner sessions).
    if (!staff) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' }
      });
    }

    const { status, assigned_to, notes } = req.body;

    // Get current request
    const { data: request, error: fetchError } = await getSupabase()
      .from('commander_service_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (fetchError || !request) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Service request not found' }
      });
    }

    const updates = {};

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid status. Must be: ${VALID_STATUSES.join(', ')}` }
        });
      }
      updates.status = status;

      // Set timestamps based on status
      if (status === 'acknowledged' && !request.acknowledged_at) {
        updates.acknowledged_at = new Date().toISOString();
      }
      if (status === 'completed' && !request.completed_at) {
        updates.completed_at = new Date().toISOString();
      }
    }

    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates || {}).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' }
      });
    }

    const { data: updated, error: updateError } = await getSupabase()
      .from('commander_service_requests')
      .update(updates)
      .eq('id', requestId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.warn('Commander service PATCH error:', updateError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to update service request' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { request: updated }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Commander service PATCH error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

// 2026-07-25 audit fix: player cancels their own service request. Identity
// comes from the verified Bearer/cookie user, never the request body.
async function handleDelete(req, res, requestId) {
  try {
    const user = await guardUser(req, res);
    if (!user) return;

    const { data: request, error: fetchError } = await getSupabase()
      .from('commander_service_requests')
      .select('id, player_id, status')
      .eq('id', requestId)
      .maybeSingle();

    if (fetchError || !request) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Service request not found' }
      });
    }

    if (String(request.player_id) !== String(user.id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You can only cancel your own service requests' }
      });
    }

    if (['completed', 'cancelled'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Request is already closed' }
      });
    }

    const { data: updated, error: updateError } = await getSupabase()
      .from('commander_service_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.warn('Commander service DELETE error:', updateError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to cancel service request' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { request: updated }
    });
  } catch (error) {
    try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Commander service DELETE error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
