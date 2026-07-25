/**
 * Service Request API
 * POST /api/commander/services/request - Submit a service request
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../src/lib/commander/auth';
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

// Auth: PLAYER — verified Bearer user submits their own service request
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    // 2026-07-25 audit fix: this is the player in-seat service request endpoint;
    // the guardOwnerStaff gate blocked players entirely. Require a verified
    // player user instead — player_id below is derived from this user.
    const user = await guardUser(req, res);
    if (!user) return;

    try {
      const {
        venue_id,
        request_type,
        details,
        table_id,
        table_number,
        seat_number
      } = req.body;

      if (!venue_id || !request_type) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'venue_id and request_type are required' }
        });
      }

      // Validate request type
      const validTypes = ['food', 'chips', 'table_change', 'cashout', 'floor'];
      if (!validTypes.includes(request_type)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_TYPE', message: 'Invalid request type' }
        });
      }

      // Check for existing pending request of same type
      const { data: existingRequest } = await getSupabase()
        .from('commander_service_requests')
        .select('id')
        .eq('player_id', user.id)
        .eq('venue_id', venue_id)
        .eq('request_type', request_type)
        .in('status', ['pending', 'in_progress'])
        .maybeSingle();

      if (existingRequest) {
        return res.status(400).json({
          success: false,
          error: { code: 'DUPLICATE_REQUEST', message: 'You already have a pending request of this type' }
        });
      }

      // Create the service request
      const { data: request, error } = await getSupabase()
        .from('commander_service_requests')
        .insert({
          player_id: user.id,
          venue_id: venue_id,
          table_id: table_id ? parseInt(table_id) : null,
          request_type,
          details,
          status: 'pending',
          metadata: {
            table_number,
            seat_number
          }
        })
        .select()
        .maybeSingle();

      if (error) throw error;

      return res.status(201).json({
        success: true,
        data: {
          request: {
            ...request,
            table_number,
            seat_number
          }
        }
      });
    } catch (error) {
      console.warn('Create service request error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to create service request' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
