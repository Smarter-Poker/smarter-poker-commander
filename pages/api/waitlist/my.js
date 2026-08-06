/**
 * Commander My Waitlists API - GET /api/commander/waitlist/my
 * Get current user's waitlist entries
 * Reference: API_REFERENCE.md - Waitlist section
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
      // Get authenticated user via JWT (consistent with all other routes)
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
        });
      }
      const { data: authData, error: authErr } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (authErr || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Invalid token' }
        });
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
        });
      }

      // Get user's waitlist entries
      const { data: entries, error } = await getSupabase()
        .from('commander_waitlist')
        .select(`
          *,
          poker_venues (
            id,
            name,
            city,
            state,
            phone
          ),
          commander_games (
            id,
            status,
            current_players,
            max_players
          )
        `)
        .eq('player_id', user.id)
        .in('status', ['waiting', 'called'])
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Commander my waitlists query error:', error);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to fetch waitlists' }
        });
      }

      // Compute the LIVE 1-based position for each entry — matching the public
      // venue waitlist ordering (created_at ascending within game_type/stakes).
      // The stored `position` column drifts as players ahead are seated, so we
      // count how many waiting/called entries in the same group were created at
      // or before this one. Falls back to the stored position on error.
      const livePositions = {};
      await Promise.all((entries || []).map(async (entry) => {
        try {
          const { count } = await getSupabase()
            .from('commander_waitlist')
            .select('id', { count: 'exact', head: true })
            .eq('venue_id', entry.venue_id)
            .eq('game_type', entry.game_type)
            .eq('stakes', entry.stakes)
            .in('status', ['waiting', 'called'])
            .lte('created_at', entry.created_at);
          if (typeof count === 'number' && count > 0) livePositions[entry.id] = count;
        } catch (posErr) { console.warn('[App] Handled exception:', posErr?.message || posErr); }
      }));

      // Format response
      const formattedEntries = (entries || []).map(entry => ({
        waitlist_entry: {
          id: entry.id,
          game_type: entry.game_type,
          stakes: entry.stakes,
          status: entry.status,
          call_count: entry.call_count,
          last_called_at: entry.last_called_at,
          checked_in_at: entry.checked_in_at,
          venue_id: entry.venue_id,
          created_at: entry.created_at
        },
        venue: entry.poker_venues,
        game: entry.commander_games,
        position: livePositions[entry.id] || entry.position,
        estimated_wait: entry.estimated_wait_minutes
      }));

      return res.status(200).json({
        success: true,
        data: { entries: formattedEntries }
      });
    } catch (error) {
      console.warn('Commander my waitlists API error:', error);
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
