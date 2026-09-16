/**
 * Player Stats API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/analytics/players - Get player stats for venue
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
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

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Authorization required' });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      const {
        venue_id,
        loyalty_tier,
        sort_by = 'total_hours',
        sort_order = 'desc',
        search,
        limit: rawLimit = '50',
        offset: rawOffset = '0'
      } = req.query;
      const limit = Math.min(parseInt(rawLimit) || 50, 500);
      const offset = parseInt(rawOffset) || 0;

      if (!venue_id) {
        return res.status(400).json({ error: 'Venue ID required' });
      }

      // Check if user is staff at this venue
      const { data: staff } = await getSupabase()
        .from('commander_staff')
        .select('id, role')
        .eq('venue_id', venue_id)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!staff) {
        return res.status(403).json({ error: 'You are not authorized to view player stats' });
      }

      let query = getSupabase()
        .from('commander_player_stats')
        .select(`
          *,
          profiles:player_id (id, display_name, avatar_url, email)
        `, { count: 'exact' })
        .eq('venue_id', venue_id);

      if (loyalty_tier) {
        query = query.eq('loyalty_tier', loyalty_tier);
      }

      // Sort options
      const validSortFields = ['total_hours', 'total_visits', 'last_visit', 'total_buyin', 'loyalty_points'];
      const sortField = validSortFields.includes(sort_by) ? sort_by : 'total_hours';
      query = query.order(sortField, { ascending: sort_order === 'asc' });

      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) throw error;

      // Filter by search if provided (post-query since we need to search profile names)
      let filteredData = data;
      if (search) {
        const searchLower = search.toLowerCase();
        filteredData = data.filter(p =>
          p.profiles?.display_name?.toLowerCase().includes(searchLower) ||
          p.profiles?.email?.toLowerCase().includes(searchLower)
        );
      }

      // Calculate tier breakdown
      const tierBreakdown = {
        bronze: 0,
        silver: 0,
        gold: 0,
        platinum: 0,
        diamond: 0
      };
      data.forEach(p => {
        if (p.loyalty_tier && tierBreakdown[p.loyalty_tier] !== undefined) {
          tierBreakdown[p.loyalty_tier]++;
        }
      });

      return res.status(200).json({
        players: filteredData,
        total: count,
        tier_breakdown: tierBreakdown,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    } catch (error) {
      console.warn('Get player stats error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
