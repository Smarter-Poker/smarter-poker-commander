import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../src/lib/commander/auth';
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
    const _g = await guardManager(req, res); if (!_g) return;

    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

    // 2026-07-25 audit fix: the table is poker_venues (there is no 'venues'
    // table) filtered to commander-enabled rooms, and the response includes a
    // server-computed summary the admin page reads at data.data.summary.
    const { data, error } = await getSupabase()
      .from('poker_venues')
      .select('id, name, city, state, commander_tier, commander_activated_at')
      .eq('commander_enabled', true)
      .order('name');
    if (error) return res.status(500).json({ success: false, error: error.message });

    const venues = data || [];
    const by_tier = {};
    for (const v of venues) {
      const tier = v.commander_tier || 'unknown';
      by_tier[tier] = (by_tier[tier] || 0) + 1;
    }
    const summary = { total: venues.length, by_tier };

    return res.json({ success: true, data: { venues, summary } });
    } catch (err) {
      console.warn('[pages/api/commander/admin/venues.js]', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
