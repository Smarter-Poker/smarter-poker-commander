import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../src/lib/commander/auth';
import crypto from 'crypto';
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
    const { venue_id } = req.query;

    if (req.method === 'GET') {
      if (!venue_id) return res.status(400).json({ success: false, error: 'venue_id required' });
      const { data, error } = await getSupabase()
        .from('commander_api_keys')
        .select('id, venue_id, name, api_key, permissions, created_at, last_used_at, is_active')
        .eq('venue_id', venue_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, data: { keys: data } });
    }

    if (req.method === 'POST') {
      const { venue_id: vid, name, permissions } = req.body;
      const apiKey = `cmd_${crypto.randomBytes(24).toString('hex')}`;
      const { data, error } = await getSupabase()
        .from('commander_api_keys')
        .insert({ venue_id: vid, name: name || 'API Key', api_key: apiKey, permissions: permissions || {}, is_active: true })
        .select()
        .maybeSingle();
      if (error) return res.status(500).json({ success: false, error: error.message });
      if (!data) return res.status(500).json({ success: false, error: 'Failed to create API key' });
      return res.json({ success: true, data: { key: data } });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('[pages/api/commander/admin/api-keys.js]', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
