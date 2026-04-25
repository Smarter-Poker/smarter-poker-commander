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

// Auth: STAFF — requires valid staff session
export default async function handler(req, res) {
  try {
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    if (!applyRateLimit(req, res, LIMITS.write)) return;
  }

  const _g = await guardStaff(req, res); if (!_g) return;
  const { id } = req.query;

  if (req.method === 'GET') {
    const { data, error } = await getSupabase().from('commander_dealers').select('*').eq('id', id).maybeSingle();
    if (error || !data) return res.status(404).json({ success: false, error: 'Dealer not found' });
    return res.json({ success: true, data: { dealer: data } });
  }

  if (req.method === 'PATCH') {
    const updates = req.body;
    delete updates.id; delete updates.venue_id;
    const { data, error } = await getSupabase().from('commander_dealers').update(updates).eq('id', id).select().maybeSingle();
    if (error || !data) return res.status(404).json({ success: false, error: 'Dealer not found' });
    return res.json({ success: true, data: { dealer: data } });
  }

  if (req.method === 'DELETE') {
    const { error } = await getSupabase().from('commander_dealers').delete().eq('id', id);
    if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
    return res.json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[pages/api/commander/dealers/[id].js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
