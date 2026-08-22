/**
 * SERVER-SIDE AUTH UTILITY - Phase 4.1d (ESM + Web Crypto port, 2026-04-25)
 *
 * Verifies Supabase JWT (HS256) locally without network calls. Returns
 * the decoded payload or null.
 *
 * SECURITY:
 * Verifies HMAC-SHA256 signature against SUPABASE_JWT_SECRET before
 * trusting any claim. Fails closed if the secret isn't configured.
 *
 * Phase 4.1d port:
 * - Switched from Node `crypto.createHmac` (Node-only) to
 *   `crypto.subtle.sign` (Web Crypto, available on Node 18+ AND edge
 *   runtime).
 * - All public functions are now async (Web Crypto is async-only).
 * - `crypto.timingSafeEqual` replaced with constant-time JS compare.
 * - Module is ESM (no more `require`/`module.exports`).
 *
 * Direct callers in this codebase (verified 2026-04-25):
 *   - getServerUser(): 0 direct callers (all go through fallback)
 *   - verifySupabaseJwt(): 0 direct callers (used by patched
 *     supabase.auth.getUser in supabaseServerClient.js)
 *   - getServerUserWithFallback(): 2 callers
 *     (pages/api/user/get-header-stats.js, pages/api/notifications/list.js)
 *     - both already do `await getServerUserWithFallback(...)`.
 *
 * So the sync→async breaking-change cost on callers was effectively
 * zero. Only the fallback internals need to add `await`.
 */

function base64UrlDecode(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToString(bytes) {
  return new TextDecoder().decode(bytes);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Verify a Supabase JWT (HS256) locally via Web Crypto. Async.
 * Returns the decoded payload object or null.
 */
export async function verifySupabaseJwt(token, secret) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  // Parse header - must be HS256
  let header;
  try {
    header = JSON.parse(bytesToString(base64UrlDecode(headerB64)));
  } catch {
    return null;
  }
  if (!header || header.alg !== 'HS256' || (header.typ && header.typ !== 'JWT')) {
    return null;
  }

  // Recompute signature via Web Crypto HMAC-SHA256
  let expected;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${headerB64}.${payloadB64}`));
    expected = new Uint8Array(sig);
  } catch (_e) {
    return null;
  }

  const got = base64UrlDecode(signatureB64);
  if (!constantTimeEqual(expected, got)) return null;

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(bytesToString(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec) return null;

  return payload;
}

let _warnedMissingSecret = false;

/**
 * Extract a verified user from the Authorization header JWT. Async.
 * Returns { id, email, role, aud } or null.
 *
 * Fails closed if SUPABASE_JWT_SECRET is not configured.
 */
export async function getServerUser(req) {
  try {
    // Support both Pages-router req (req.headers.authorization) and
    // edge Request (req.headers.get('authorization'))
    let authHeader;
    if (req?.headers?.get) {
      authHeader = req.headers.get('authorization');
    } else {
      authHeader = req?.headers?.authorization;
    }

    if (!authHeader || typeof authHeader !== 'string') return null;
    if (!authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.slice(7).trim();
    if (!token || token.length < 20) return null;

    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      if (!_warnedMissingSecret) {
        _warnedMissingSecret = true;
        console.warn('[serverAuth] SUPABASE_JWT_SECRET not set - JWT verification disabled.');
      }
      return null;
    }

    const payload = await verifySupabaseJwt(token, secret);
    if (!payload) return null;

    const userId = payload.sub;
    if (!userId || typeof userId !== 'string') return null;

    return {
      id: userId,
      email: payload.email || null,
      role: payload.role || 'authenticated',
      aud: payload.aud || null,
    };
  } catch (e) {
    console.warn('[serverAuth] handled exception:', e?.message || e);
    return null;
  }
}

/**
 * Full auth extraction with supabase.auth.getUser fallback.
 * Tries local HMAC verification first, then network call to GoTrue.
 *
 * The fallback is safe (GoTrue verifies the signature server-side),
 * but slower. Use only when you need operational resilience during
 * a JWT_SECRET rotation window.
 */
export async function getServerUserWithFallback(req, supabase) {
  // 1. Fast path: local HMAC verification.
  const localUser = await getServerUser(req);
  if (localUser) return { user: localUser, error: null };

  // 2. Fallback: network call to GoTrue.
  try {
    let token;
    if (req?.headers?.get) {
      const h = req.headers.get('authorization');
      token = h ? h.replace('Bearer ', '') : null;
    } else {
      token = req?.headers?.authorization?.replace('Bearer ', '');
    }
    if (!token) return { user: null, error: 'No token' };

    const { data: authData, error } = await supabase.auth.getUser(token);
    const user = authData?.user;
    if (user) return { user, error: null };
    return { user: null, error: error?.message || 'Invalid token' };
  } catch (e) {
    return { user: null, error: e.message };
  }
}
