/**
 * My Tournament Registrations API
 * GET /api/commander/tournaments/my - Get player's tournament registrations
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
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' }
      });
    }

    try {
      const { status, limit = 20, offset = 0 } = req.query;

      // 2026-07-25 audit fix: select real columns payout_amount/rebuy_count
      // (prize_amount/reentry_number do not exist and made the query fail)
      let query = getSupabase()
        .from('commander_tournament_entries')
        .select(`
          id,
          status,
          registered_at,
          finish_position,
          payout_amount,
          rebuy_count,
          commander_tournaments:tournament_id (
            id,
            name,
            status,
            scheduled_start,
            buyin_amount,
            buyin_fee,
            guaranteed_pool,
            current_entries,
            max_entries,
            poker_venues:venue_id (id, name, city, state)
          )
        `, { count: 'exact' })
        .eq('player_id', user.id)
        .order('registered_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data: registrations, error, count } = await query;

      if (error) throw error;

      // Format response
      const formattedRegistrations = registrations?.map(r => ({
        id: r.id,
        status: r.status,
        registered_at: r.registered_at,
        finish_position: r.finish_position,
        // 2026-07-25 audit fix: prize_amount/reentry_number are not real columns;
        // select payout_amount/rebuy_count and keep the client-facing keys.
        prize_amount: r.payout_amount,
        reentry_number: r.rebuy_count,
        tournament_id: r.commander_tournaments?.id,
        tournament_name: r.commander_tournaments?.name,
        tournament_status: r.commander_tournaments?.status,
        scheduled_start: r.commander_tournaments?.scheduled_start,
        buyin: r.commander_tournaments?.buyin_amount,
        fee: r.commander_tournaments?.buyin_fee,
        prizepool: r.commander_tournaments?.guaranteed_pool,
        entries: r.commander_tournaments?.current_entries,
        max_entries: r.commander_tournaments?.max_entries,
        venue: r.commander_tournaments?.poker_venues
      })) || [];

      return res.status(200).json({
        success: true,
        data: {
          registrations: formattedRegistrations,
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });
    } catch (error) {
      console.warn('Get my tournaments error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to get tournament registrations' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
