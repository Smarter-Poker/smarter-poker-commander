/**
 * Streaming Index API
 * GET /api/commander/streaming - List streams for a venue
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    // Auth guard: require staff auth
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    const { venue_id } = req.query;

    if (!venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'venue_id required' }
      });
    }

    try {
      // Get all tables for venue
      const { data: tables, error: tablesError } = await getSupabase()
        .from('commander_tables')
        .select('id, table_number, status, max_seats')
        .eq('venue_id', venue_id)
        .order('table_number')
            .limit(100)

      if (tablesError) throw tablesError;

      // Get existing stream records
      const tableIds = (tables || []).map(t => t.id);

      let streams = [];
      if (tableIds.length > 0) {
        const { data: streamData, error: streamError } = await getSupabase()
          .from('commander_streams')
          .select('*')
          .in('table_id', tableIds);

        if (!streamError) {
          streams = streamData || [];
        }
      }

      // Get active games for tables
      const { data: games } = await getSupabase()
        .from('commander_games')
        .select('id, table_id, game_type, stakes, current_players')
        .in('table_id', tableIds)
        .in('status', ['waiting', 'running'])
            .limit(100)

      const gamesByTable = {};
      (games || []).forEach(g => {
        gamesByTable[g.table_id] = g;
      });

      const streamsByTable = {};
      streams.forEach(s => {
        streamsByTable[s.table_id] = s;
      });

      // Build response with all tables and their stream status
      const result = (tables || []).map(table => {
        const stream = streamsByTable[table.id];
        const game = gamesByTable[table.id];

        return {
          table_id: table.id,
          table_number: table.table_number,
          status: stream?.status || 'offline',
          platforms: stream?.platforms || [],
          delay_minutes: stream?.delay_minutes || 15,
          overlay_config: stream?.overlay_config || {},
          started_at: stream?.started_at || null,
          viewer_count: stream?.viewer_count || 0,
          game_info: game ? `${game.stakes} ${game.game_type?.toUpperCase() || 'NLH'}` : null
        };
      });

      return res.status(200).json({
        success: true,
        data: {
          streams: result,
          summary: {
            total_tables: result.length,
            live_count: result.filter(s => s.status === 'live').length
          }
        }
      });
    } catch (error) {
      console.warn('List streams error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch streams' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
