/**
 * System Information API
 * GET /api/commander/system-info - Get system health, version, recent log
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

const APP_VERSION = '1.0.0';
const BUILD_DATE = '2026-02-12';

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });

      // 2026-07-25 audit fix: staff rows link via user_id OR linked_user_id -
      // matching only user_id locked out staff linked the other way.
      const { data: staff } = await getSupabase()
        .from('commander_staff')
        .select('venue_id, role, display_name')
        .or(`linked_user_id.eq.${user.id},user_id.eq.${user.id}`)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (!staff) return res.status(403).json({ success: false, error: 'Staff access required' });

      const venueId = staff.venue_id;

      // Health checks
      const healthChecks = {};

      // 1. Database connectivity
      const dbStart = Date.now();
      const { error: dbErr } = await getSupabase().from('poker_venues').select('id').eq('id', venueId).maybeSingle();
      healthChecks.database = {
        status: dbErr ? 'error' : 'healthy',
        latency_ms: Date.now() - dbStart,
        error: dbErr?.message || null
      };

      // 2. Get venue info
      const { data: venue } = await getSupabase()
        .from('poker_venues')
        .select('id, name, created_at')
        .eq('id', venueId)
        .maybeSingle();

      // 3. Count active resources
      const [tablesRes, staffRes, gamesRes, membersRes] = await Promise.all([
        getSupabase().from('commander_tables').select('id', { count: 'exact', head: true }).eq('venue_id', venueId),
        getSupabase().from('commander_staff').select('id', { count: 'exact', head: true }).eq('venue_id', venueId).eq('is_active', true),
        getSupabase().from('commander_games').select('id', { count: 'exact', head: true }).eq('venue_id', venueId).in('status', ['waiting', 'running']),
        getSupabase().from('commander_members').select('id', { count: 'exact', head: true }).eq('venue_id', venueId)
      ]);

      // 4. Recent system log
      const { data: recentLog } = await getSupabase()
        .from('commander_system_log')
        .select('*')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false })
        .limit(20);

      // 5. API health (self-check)
      healthChecks.api = { status: 'healthy', latency_ms: 0 };

      return res.status(200).json({
        success: true,
        data: {
          version: APP_VERSION,
          build_date: BUILD_DATE,
          environment: process.env.NODE_ENV || 'production',
          platform: 'Club Commander Cloud',
          venue: venue ? { id: venue.id, name: venue.name, created_at: venue.created_at } : null,
          health: healthChecks,
          counts: {
            tables: tablesRes.count || 0,
            active_staff: staffRes.count || 0,
            active_games: gamesRes.count || 0,
            total_members: membersRes.count || 0
          },
          recent_log: recentLog || [],
          server_time: new Date().toISOString(),
          uptime_note: 'Cloud-hosted - 99.9% uptime SLA'
        }
      });
    } catch (err) {
      console.warn('System info error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
