/**
 * Commander Live Games API - GET /api/commander/games/live [Public]
 * Get all currently running games
 * Reference: API_REFERENCE.md - Games section
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
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

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    try {
      const { venue_id, game_type, stakes, limit = 100 } = req.query;

      let query = getSupabase()
        .from('commander_games')
        .select(`
          *,
          poker_venues (
            id,
            name,
            city,
            state
          ),
          commander_tables!commander_games_table_id_fkey (
            id,
            table_number,
            table_name
          )
        `)
        .in('status', ['waiting', 'running'])
        .order('created_at', { ascending: false })
        .limit(Math.min(parseInt(limit) || 50, 500));

      // Filter by venue
      if (venue_id) {
        query = query.eq('venue_id', venue_id);
      }

      // Filter by game type
      if (game_type) {
        // 2026-07-25 audit fix: commander_games.game_type is lowercase now - ilike (no wildcards) = case-insensitive equality
        query = query.ilike('game_type', game_type);
      }

      // Filter by stakes
      if (stakes) {
        query = query.eq('stakes', stakes);
      }

      const { data, error } = await query;

      if (error) {
        console.warn('Commander live games query error:', error);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to fetch games' }
        });
      }

      // Get waitlist counts for each game
      const games = await Promise.all((data || []).map(async (game) => {
        const { count } = await getSupabase()
          .from('commander_waitlist')
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', game.venue_id)
          .ilike('game_type', game.game_type) // 2026-07-25 audit fix: waitlist rows may differ in case from lowercase games
          .eq('stakes', game.stakes)
          .eq('status', 'waiting')

        return {
          ...game,
          waitlist_count: count || 0
        };
      }));

      return res.status(200).json({
        success: true,
        data: { games }
      });
    } catch (error) {
      console.warn('Commander live games API error:', error);
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
