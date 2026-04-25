import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/sentryWrap';

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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else {
      if (!applyRateLimit(req, res, LIMITS.read)) return;
    }

    const _g = await guardManager(req, res); if (!_g) return;
    const { id } = req.query;

    if (req.method === 'GET') {
      const { data, error } = await getSupabase().from('commander_venue_settings').select('*').eq('venue_id', id).maybeSingle();
      if (error) return res.json({ success: true, data: { settings: {} } });
      return res.json({ success: true, data: { settings: data } });
    }

    if (req.method === 'PATCH') {
      const { data, error } = await getSupabase()
        .from('commander_venue_settings')
        .upsert({ venue_id: id, ...req.body }, { onConflict: 'venue_id' })
        .select()
        .maybeSingle();
      if (error) return res.status(500).json({ success: false, error: error.message });
      if (!data) return res.status(500).json({ success: false, error: 'Failed to update settings' });
      return res.json({ success: true, data: { settings: data } });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
