/**
 * SERVER-SIDE AUTH UTILITY - Phase 4.2 (ES256 / JWKS, 2026-09-01)
 *
 * Verifies Supabase JWTs locally without a network call per request.
 *
 * WHY THIS CHANGED
 * ----------------
 * This module previously hardcoded `header.alg !== 'HS256'` and verified
 * with HMAC-SHA256 against SUPABASE_JWT_SECRET. The project has since
 * migrated to asymmetric signing keys: the JWKS endpoint now serves only
 * ES256 (P-256) keys and no symmetric key exists.
 *
 * Result: EVERY token failed the alg gate and returned null, so every
 * caller fell through to a live `GET /auth/v1/user` against GoTrue. That
 * produced ~20M edge requests/24h, GoTrue rate limiting, cascading 403s,
 * and ultimately the auth redirect loop. See auth_logs:
 *   "token signature is invalid: signing method HS256 is invalid" x14,003
 *
 * This version verifies ES256 against the project's JWKS, caches the key
 * set in module memory, and refetches on unknown `kid` (key rotation).
 *
 * Still fails closed: an unverifiable token returns null.
 *
 * All public functions remain async with identical signatures and return
 * shapes, so no call site needs to change.
 */

const JWKS_TTL_MS = 10 * 60 * 1000; // 10 min
const JWKS_REFETCH_COOLDOWN_MS = 30 * 1000; // don't hammer on unknown kid

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

function jwksUrl() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!base) return null;
  return `${String(base).replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;
}

// --- JWKS cache -----------------------------------------------------------

let _jwksCache = null; // { keys: Map<kid, CryptoKey>, fetchedAt: number }
let _jwksInflight = null; // de-dupe concurrent fetches
let _lastRefetchAt = 0;
let _warnedMissingUrl = false;

async function importEs256Jwk(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

async function fetchJwks() {
  const url = jwksUrl();
  if (!url) {
    if (!_warnedMissingUrl) {
      _warnedMissingUrl = true;
      console.warn('[serverAuth] NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL not set - JWT verification disabled.');
    }
    return null;
  }

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.keys)) throw new Error('JWKS malformed');

  const keys = new Map();
  for (const jwk of body.keys) {
    // Only ES256 signing keys are usable here.
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') continue;
    if (jwk.alg && jwk.alg !== 'ES256') continue;
    if (jwk.use && jwk.use !== 'sig') continue;
    if (!jwk.kid) continue;
    try {
      keys.set(jwk.kid, await importEs256Jwk(jwk));
    } catch (e) {
      console.warn('[serverAuth] skipping unimportable JWK', jwk.kid, e?.message || e);
    }
  }

  _jwksCache = { keys, fetchedAt: Date.now() };
  return _jwksCache;
}

async function getJwks({ force = false } = {}) {
  const fresh = _jwksCache && Date.now() - _jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && !force) return _jwksCache;

  if (_jwksInflight) return _jwksInflight;

  _jwksInflight = fetchJwks()
    .catch((e) => {
      console.warn('[serverAuth] JWKS fetch error:', e?.message || e);
      // Serve stale cache rather than failing every request during an outage.
      return _jwksCache;
    })
    .finally(() => {
      _jwksInflight = null;
    });

  return _jwksInflight;
}

async function resolveKey(kid) {
  let jwks = await getJwks();
  if (jwks?.keys?.has(kid)) return jwks.keys.get(kid);

  // Unknown kid -> a key was likely just rotated in. Refetch, with a cooldown
  // so a bogus kid can't turn into a JWKS request per inbound request.
  if (Date.now() - _lastRefetchAt > JWKS_REFETCH_COOLDOWN_MS) {
    _lastRefetchAt = Date.now();
    jwks = await getJwks({ force: true });
    if (jwks?.keys?.has(kid)) return jwks.keys.get(kid);
  }
  return null;
}

// --- Verification ---------------------------------------------------------

/**
 * Verify a Supabase JWT (ES256) against the project JWKS. Async.
 * Returns the decoded payload object or null.
 *
 * NOTE: the legacy second parameter (`secret`) is accepted and ignored so
 * that any straggling call site keeps working during rollout.
 */
export async function verifySupabaseJwt(token, _legacySecretIgnored) {
  if (typeof token !== 'string' || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  try {
    header = JSON.parse(bytesToString(base64UrlDecode(headerB64)));
  } catch {
    return null;
  }
  if (!header || header.alg !== 'ES256' || (header.typ && header.typ !== 'JWT')) {
    return null;
  }
  if (!header.kid || typeof header.kid !== 'string') return null;

  const key = await resolveKey(header.kid);
  if (!key) return null;

  // ECDSA P-256 JWS signatures are the raw 64-byte (r||s) form, which is
  // exactly what Web Crypto expects for { name: 'ECDSA', hash: 'SHA-256' }.
  let ok = false;
  try {
    const sig = base64UrlDecode(signatureB64);
    if (sig.length !== 64) return null;
    ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      key,
      sig,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
  } catch (_e) {
    return null;
  }
  if (!ok) return null;

  let payload;
  try {
    payload = JSON.parse(bytesToString(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec) return null;

  // Claim validation the previous implementation omitted entirely.
  const expectedIss = jwksUrl()?.replace('/.well-known/jwks.json', '');
  if (expectedIss && payload.iss && payload.iss !== expectedIss) return null;
  if (payload.aud && payload.aud !== 'authenticated') return null;

  return payload;
}

/**
 * Extract a verified user from the Authorization header JWT. Async.
 * Returns { id, email, role, aud } or null.
 */
export async function getServerUser(req) {
  try {
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

    const payload = await verifySupabaseJwt(token);
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
 * Tries local JWKS verification first, then a network call to GoTrue.
 *
 * The fallback should now be genuinely rare. If you see GoTrue /user
 * request volume tracking your API request volume, local verification is
 * broken again and this fallback is masking it.
 */
export async function getServerUserWithFallback(req, supabase) {
  // 1. Fast path: local ES256 verification against cached JWKS.
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
