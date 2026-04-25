/**
 * Commander Games at Venue API - GET /api/commander/games/venue/:venueId [Public]
 * Get all games at a specific venue
 * Reference: API_REFERENCE.md - Games section
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

    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Venue ID required' }
      });
    }

    try {
      // Get games — try with joins first, fallback to simple query
      let games = [];
      try {
        const result = await getSupabase()
          .from('commander_games')
          .select(`
            *,
            commander_tables!commander_games_table_id_fkey (
              id,
              table_number,
              table_name,
              max_seats
            )
          `)
          .eq('venue_id', venueId)
          .in('status', ['waiting', 'running', 'breaking'])
          .order('created_at', { ascending: false });

        if (result.error) throw result.error;
        games = result.data || [];
      } catch {
        // Fallback: simple query without FK joins
        const result = await getSupabase()
          .from('commander_games')
          .select('*')
          .eq('venue_id', venueId)
          .in('status', ['waiting', 'running', 'breaking'])
          .order('created_at', { ascending: false })
        games = result.data || [];
      }

      // Get all tables at venue
      const { data: tables, error: tablesError } = await getSupabase()
        .from('commander_tables')
        .select('*')
        .eq('venue_id', venueId)
        .order('table_number', { ascending: true })

      if (tablesError) {
        console.warn('Commander venue tables query error:', tablesError);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to fetch tables' }
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          games: games || [],
          tables: tables || []
        }
      });
    } catch (error) {
      console.warn('Commander venue games API error:', error);
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
