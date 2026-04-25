/**
 * Commander Tables at Venue API - GET /api/commander/tables/venue/:venueId
 * Get all tables at a specific venue
 * Reference: Phase 2 - Table CRUD
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    const { venueId, status, include_games } = req.query;

    if (!venueId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Venue ID required' }
      });
    }

    try {
      let selectQuery = '*';
      if (include_games === 'true') {
        selectQuery = `
          *,
          commander_games (
            id,
            game_type,
            stakes,
            status,
            current_players,
            max_players,
            started_at
          )
        `;
      }

      let query = getSupabase()
        .from('commander_tables')
        .select(selectQuery)
        .eq('venue_id', venueId)
        .order('table_number', { ascending: true })
            .limit(100)

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        console.warn('Commander venue tables query error:', error);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to fetch tables' }
        });
      }

      // Calculate summary stats
      const summary = {
        total: data?.length || 0,
        available: data?.filter(t => t.status === 'available').length || 0,
        in_use: data?.filter(t => t.status === 'in_use').length || 0,
        reserved: data?.filter(t => t.status === 'reserved').length || 0,
        maintenance: data?.filter(t => t.status === 'maintenance').length || 0
      };

      return res.status(200).json({
        success: true,
        data: {
          tables: data || [],
          summary
        }
      });
    } catch (error) {
      console.warn('Commander venue tables API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
