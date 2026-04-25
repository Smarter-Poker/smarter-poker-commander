/**
 * POST /api/admin/pin-setup
 *
 * One-time PIN setup for a commander admin. Calls the
 * set_commander_admin_pin RPC which upserts the salted+hashed PIN
 * into commander_admin_pins keyed by auth.uid().
 *
 * Body: { pin: string }
 * Returns: 200 on success, 401/400 on auth/validation errors
 */
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  const token = authHeader.slice(7).trim();

  const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { pin } = req.body || {};
  if (typeof pin !== 'string' || pin.length < 4 || pin.length > 12) {
    return res.status(400).json({ error: 'PIN must be 4-12 chars' });
  }

  // Verify caller is actually a commander admin (must have a row in
  // commander_staff with admin role, OR be in the venue owner list).
  const { data: staff } = await getSupabase()
    .from('commander_staff')
    .select('id, role')
    .eq('user_id', user.id)
    .in('role', ['owner', 'manager', 'admin'])
    .limit(1)
    .maybeSingle();

  if (!staff) {
    return res.status(403).json({ error: 'Admin role required' });
  }

  const pinHash = await sha256Hex(`${user.id}:${pin}`);

  const { error: rpcErr } = await getSupabase()
    .rpc('set_commander_admin_pin', { p_pin_hash: pinHash });

  if (rpcErr) {
    console.warn('[pin-setup] RPC error:', rpcErr.message);
    return res.status(500).json({ error: 'PIN setup failed' });
  }

  return res.status(200).json({ ok: true });
}
