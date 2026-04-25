/**
 * Escrow List API
 * GET /api/commander/escrow - List escrow transactions for a home game
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
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authorization required' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
        });
      }

      const { home_game_id, status, limit: rawLimit = '50', offset: rawOffset = '0' } = req.query;
      const limit = Math.min(parseInt(rawLimit) || 50, 500);
      const offset = parseInt(rawOffset) || 0;

      if (!home_game_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'home_game_id required' }
        });
      }

      // Verify user is host of the home game
      const { data: game, error: gameError } = await getSupabase()
        .from('commander_home_games')
        .select('id, host_id')
        .eq('id', home_game_id)
        .maybeSingle();

      if (gameError || !game) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Home game not found' }
        });
      }

      if (game.host_id !== user.id) {
        // Also check if user is a player with transactions
        const { data: playerTxn } = await getSupabase()
          .from('commander_escrow_transactions')
          .select('id')
          .eq('home_game_id', home_game_id)
          .eq('player_id', user.id)
          .limit(1)
          .maybeSingle();

        if (!playerTxn) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Only host or participants can view escrow transactions' }
          });
        }
      }

      let query = getSupabase()
        .from('commander_escrow_transactions')
        .select(`
          *,
          profiles:player_id (id, display_name, avatar_url)
        `, { count: 'exact' })
        .eq('home_game_id', home_game_id)
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      // Map profile data to player_name for convenience
      const transactions = (data || []).map(t => ({
        ...t,
        player_name: t.profiles?.display_name || 'Player'
      }));

      return res.status(200).json({
        success: true,
        data: {
          transactions,
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });
    } catch (error) {
      console.warn('List escrow error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to list transactions' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
