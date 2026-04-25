/**
 * POST /api/admin/pin-verify
 *
 * Phase 3.6 — server-side PIN gate. Replaces the legacy client-side
 * verification in src/lib/commander/clientAuth.js.
 *
 * Body: { pin: string }
 * Returns:
 *   200 + sets HttpOnly cookie on success
 *   401 on mismatch (with fail-counter increment)
 *   429 on lockout (after 5 fails, 15-min cooldown)
 *
 * The PIN is hashed via Web Crypto SHA-256 + per-user salt server-side.
 * Stored in commander_admin_pins table via SECURITY DEFINER RPC
 * verify_commander_admin_pin(p_pin_hash).
 */
import { createClient } from '@supabase/supabase-js';
import { createPinSession, buildSessionCookie } from '../../../src/lib/auth/pinSession.js';

export const runtime = 'nodejs'; // need Bearer header parse — keep on Node for now

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

  // Verify Supabase user via Bearer token
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

  // Salt PIN with user.id so a leaked single hash is not portable
  const pinHash = await sha256Hex(`${user.id}:${pin}`);

  // Call SECURITY DEFINER RPC — handles fail-counter + lockout server-side
  const { data: verified, error: rpcErr } = await getSupabase()
    .rpc('verify_commander_admin_pin', { p_pin_hash: pinHash });

  if (rpcErr) {
    console.warn('[pin-verify] RPC error:', rpcErr.message);
    return res.status(500).json({ error: 'Verification failed' });
  }

  if (!verified) {
    return res.status(401).json({ error: 'PIN incorrect or account locked' });
  }

  // PIN ok — issue signed session cookie
  try {
    const cookieValue = await createPinSession(user.id);
    res.setHeader('Set-Cookie', buildSessionCookie(cookieValue));
    return res.status(200).json({ ok: true, ttlSec: 30 * 60 });
  } catch (err) {
    console.warn('[pin-verify] session create failed:', err.message);
    return res.status(500).json({ error: 'Session create failed' });
  }
}
