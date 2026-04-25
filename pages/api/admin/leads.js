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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else {
      if (!applyRateLimit(req, res, LIMITS.read)) return;
    }

    try {
    const _g = await guardManager(req, res); if (!_g) return;

    if (req.method === 'GET') {
      const { status } = req.query;
      let query = getSupabase().from('commander_leads').select('*').order('created_at', { ascending: false });
      if (status && status !== 'all') query = query.eq('status', status);
      const { data, error } = await query;
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, data: { leads: data } });
    }

    if (req.method === 'PATCH') {
      const { id, status, notes } = req.body;
      if (!id) return res.status(400).json({ success: false, error: 'id required' });
      const updates = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;
      const { data, error } = await getSupabase().from('commander_leads').update(updates).eq('id', id).select().maybeSingle();
      if (error || !data) return res.status(404).json({ success: false, error: 'Lead not found' });
      return res.json({ success: true, data: { lead: data } });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('[pages/api/commander/admin/leads.js]', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
