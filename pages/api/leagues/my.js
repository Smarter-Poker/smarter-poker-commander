import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../src/lib/commander/auth';
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

    try {
    const _u = await guardUser(req, res); if (!_u) return;

    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const { data: standings, error } = await getSupabase()
      .from('commander_league_standings')
      .select('*, commander_leagues!inner(id, name, venue_id, season, status)')
      .eq('player_id', _u.id)
      .order('updated_at', { ascending: false })
          .limit(100);

    if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
    return res.json({ success: true, data: { leagues: standings } });
    } catch (err) {
      console.warn('[pages/api/commander/leagues/my.js]', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
