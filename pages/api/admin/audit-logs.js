import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../src/lib/commander/auth';
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

    try {
    const _g = await guardManager(req, res); if (!_g) return;

    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const { venue_id, page = 1, limit = 50, action, staff_id } = req.query;
    if (!venue_id) return res.status(400).json({ success: false, error: 'venue_id required' });

    let query = getSupabase()
      .from('commander_audit_logs')
      .select('*', { count: 'exact' })
      .eq('venue_id', venue_id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (action) query = query.eq('action', action);
    if (staff_id) query = query.eq('staff_id', staff_id);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.json({ success: true, data: { logs: data, total: count, page: Number(page), limit: Number(limit) } });
    } catch (err) {
      console.warn('[pages/api/commander/admin/audit-logs.js]', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
