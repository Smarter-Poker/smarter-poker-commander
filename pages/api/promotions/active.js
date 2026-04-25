/**
 * Active Promotions API - GET /api/commander/promotions/active
 * Public endpoint for players to view active promotions at a venue
 * Reference: API_REFERENCE.md - Promotions section
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

    try {
      const { venue_id, promotion_type, limit = 20 } = req.query;

      if (!venue_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'venue_id required' }
        });
      }

      const now = new Date().toISOString();

      let query = getSupabase()
        .from('commander_promotions')
        .select(`
          id,
          name,
          description,
          promotion_type,
          prize_type,
          prize_value,
          prize_description,
          start_date,
          end_date,
          days_of_week,
          start_time,
          end_time,
          is_recurring,
          min_stakes,
          min_hours_played,
          game_types,
          qualifying_hands,
          is_featured,
          image_url,
          terms_conditions,
          venue_id,
          poker_venues:venue_id (id, name, city, state)
        `)
        .eq('venue_id', venue_id)
        .eq('status', 'active')
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(Math.min(parseInt(limit) || 50, 500));

      if (promotion_type) {
        query = query.eq('promotion_type', promotion_type);
      }

      const { data: promotions, error } = await query;

      if (error) throw error;

      // Filter by date range - only show promotions currently within their date window
      const active = (promotions || []).filter(p => {
        if (p.start_date && new Date(p.start_date) > new Date(now)) return false;
        if (p.end_date && new Date(p.end_date) < new Date(now)) return false;
        return true;
      });

      return res.status(200).json({
        success: true,
        data: { promotions: active }
      });
    } catch (error) {
      console.warn('Active promotions error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch active promotions' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
