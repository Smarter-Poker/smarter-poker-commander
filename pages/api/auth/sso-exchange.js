/**
 * POST /api/auth/sso-exchange
 *
 * Commander-side SSO token exchange.
 *
 * Receives the one-time raw token + user ID from /auth/sso, verifies it
 * against the hashed record in Supabase, marks it consumed, then returns
 * the user's Supabase access + refresh tokens so the page can call
 * supabase.auth.setSession().
 *
 * This runs on commander.smarter.poker. It uses the service role key to
 * bypass RLS on sso_bridge_tokens and to generate a magic-link token for
 * the user.
 */
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Module-level admin client (server-only, never sent to browser)
let _adminClient = null;
function getAdminClient() {
  if (!_adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('[sso-exchange] SUPABASE_SERVICE_ROLE_KEY not configured');
    _adminClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return _adminClient;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, uid } = req.body || {};

  if (!token || !uid || typeof token !== 'string' || typeof uid !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid token/uid' });
  }

  // Sanity check token length (64 hex chars = 32 bytes)
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Invalid token format' });
  }

  try {
    const admin = getAdminClient();

    // Hash the incoming raw token to compare against the stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Look up the token row
    const { data: row, error: lookupError } = await admin
      .from('sso_bridge_tokens')
      .select('id, user_id, expires_at, used')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupError || !row) {
      return res.status(401).json({ error: 'Invalid or expired SSO token' });
    }

    // Reject if already used (replay protection)
    if (row.used) {
      return res.status(401).json({ error: 'SSO token already used' });
    }

    // Reject if expired
    if (new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'SSO token has expired - please sign in again' });
    }

    // Reject if uid doesn't match (prevents token-uid substitution attacks)
    if (row.user_id !== uid) {
      return res.status(401).json({ error: 'Token/user mismatch' });
    }

    // Mark token as used immediately (consumed-once, prevents replay in race)
    await admin
      .from('sso_bridge_tokens')
      .update({ used: true })
      .eq('id', row.id);

    // Clean up expired tokens opportunistically (keeps table small)
    admin
      .from('sso_bridge_tokens')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .then(() => {}) // fire-and-forget
      .catch(() => {});

    // Generate a sign-in link for the user (admin API - bypasses password)
    // generateLink returns a magic link; we extract the tokens from it.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: uid, // generateLink needs email, not UUID - fetch it first
    });

    // generateLink requires email; fetch user email from auth.users
    if (linkError || !linkData) {
      // Fallback: use the Supabase admin.getUserById + custom token approach
      const { data: userData, error: userErr } = await admin.auth.admin.getUserById(uid);
      if (userErr || !userData?.user) {
        return res.status(500).json({ error: 'Could not retrieve user data' });
      }

      const email = userData.user.email;
      const { data: link2, error: link2Err } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });

      if (link2Err || !link2) {
        return res.status(500).json({ error: 'Could not generate session token' });
      }

      // Extract hashed_token and type from the link
      const url = new URL(link2.properties?.action_link || '');
      const hashed_token = url.searchParams.get('token');
      const tokenType = url.searchParams.get('type');

      if (!hashed_token) {
        return res.status(500).json({ error: 'Could not extract token from magic link' });
      }

      // Return hashed_token + type for the client to call verifyOtp
      return res.status(200).json({
        method: 'otp',
        email,
        token: hashed_token,
        type: tokenType || 'magiclink',
      });
    }

    const url = new URL(linkData.properties?.action_link || '');
    const hashed_token = url.searchParams.get('token');
    const tokenType = url.searchParams.get('type');
    const email = linkData.user?.email;

    if (!hashed_token || !email) {
      return res.status(500).json({ error: 'Could not extract token from magic link' });
    }

    return res.status(200).json({
      method: 'otp',
      email,
      token: hashed_token,
      type: tokenType || 'magiclink',
    });
  } catch (err) {
    console.error('[sso-exchange] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
