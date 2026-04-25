import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

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

    try {
    const _g = await guardManager(req, res); if (!_g) return;
    const { id } = req.query;

    if (req.method === 'DELETE') {
      const { error } = await getSupabase().from('commander_api_keys').update({ is_active: false }).eq('id', id);
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('[pages/api/commander/admin/api-keys/[id].js]', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
