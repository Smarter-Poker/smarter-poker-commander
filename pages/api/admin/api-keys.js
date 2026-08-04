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

// commander_api_keys stores key_hash + key_prefix only (verified against
// information_schema) — raw keys are never persisted. No verifier for these
// keys exists in this repo yet; sha256 hex of the full key is the canonical
// hash, so any future verifier must compare sha256(presentedKey) against
// key_hash.
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
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
        .select('id, venue_id, name, key_prefix, permissions, rate_limit, is_active, last_used_at, use_count, created_at, expires_at')
        .eq('venue_id', venue_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, data: { keys: data } });
    }

    if (req.method === 'POST') {
      const { venue_id: vid, name, permissions } = req.body;
      if (!vid) return res.status(400).json({ success: false, error: 'venue_id required' });
      const apiKey = `cmd_live_${crypto.randomBytes(32).toString('hex')}`;
      const { data, error } = await getSupabase()
        .from('commander_api_keys')
        .insert({
          venue_id: vid,
          name: name || 'API Key',
          key_hash: hashApiKey(apiKey),
          key_prefix: apiKey.slice(0, 12),
          permissions: Array.isArray(permissions) ? permissions : [],
          is_active: true
        })
        .select('id, venue_id, name, key_prefix, permissions, rate_limit, is_active, created_at, expires_at')
        .maybeSingle();
      if (error) return res.status(500).json({ success: false, error: error.message });
      if (!data) return res.status(500).json({ success: false, error: 'Failed to create API key' });
      // The raw key is returned exactly once and cannot be recovered later —
      // only its sha256 hash is stored.
      return res.json({
        success: true,
        data: {
          key: data,
          api_key: apiKey,
          notice: 'Save this key now. It is shown only this once and cannot be retrieved again.'
        }
      });
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
