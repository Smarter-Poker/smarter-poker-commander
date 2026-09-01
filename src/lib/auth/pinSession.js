/**
 * Commander admin PIN session helper - server-side only.
 *
 * Phase 3.6 of the optimization plan replaces the legacy client-side
 * PIN gate (which left admin HTML visible without auth) with a
 * server-side cookie-based session.
 *
 * Cookie shape:
 *   commander_admin_session = base64url({userId, exp})
 *   Signed with HMAC-SHA256 using COMMANDER_PIN_SESSION_SECRET, falling
 *   back to SUPABASE_JWT_SECRET. See the note on getPinSessionSecret().
 *
 * Lifecycle:
 *   - 30 min sliding window
 *   - HttpOnly + Secure + SameSite=Lax + Path=/
 *   - Cleared on /api/admin/pin-logout
 */

const SESSION_COOKIE = 'commander_admin_session';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

/**
 * Resolve the HMAC signing secret for the admin PIN session cookie.
 *
 * [2026-09-01] This used to read SUPABASE_JWT_SECRET directly, on the
 * reasoning that reusing one secret keeps the secret count down. That coupling
 * became a live hazard: after the ES256/JWKS migration (PR #77) nothing reads
 * SUPABASE_JWT_SECRET for JWT verification any more. It is dead config for its
 * original purpose - .github/workflows/ci.yml even sets it to a literal
 * `dummy` - so it is exactly the kind of variable someone deletes during
 * cleanup. Deleting it would have silently invalidated every live admin PIN
 * session and locked admins out of the dashboard, with nothing in the logs
 * pointing at the cause.
 *
 * The dedicated variable is COMMANDER_PIN_SESSION_SECRET.
 *
 * DO NOT REMOVE THE SUPABASE_JWT_SECRET FALLBACK YET. Removing it today
 * invalidates every session signed with that secret the moment this deploys -
 * the precise failure this change exists to prevent. The fallback can be
 * dropped only once COMMANDER_PIN_SESSION_SECRET is set, to the SAME value, in
 * every environment. See .env.example.
 *
 * Changing the value of the resolved secret invalidates all admin PIN
 * sessions; admins simply re-enter their PIN.
 *
 * NOTE: this .js copy is the one middleware.ts imports, so it is on the hot
 * path for every admin request. Keep it in sync with pinSession.ts.
 */
function getPinSessionSecret() {
  return process.env.COMMANDER_PIN_SESSION_SECRET || process.env.SUPABASE_JWT_SECRET;
}

function base64UrlEncode(bytes) {
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return base64UrlEncode(sig);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Issue a new PIN session cookie value (signed). Caller must set the cookie
 * via res.setHeader('Set-Cookie', ...).
 */
export async function createPinSession(userId) {
  const secret = getPinSessionSecret();
  if (!secret) {
    throw new Error(
      '[pinSession] no signing secret configured - set COMMANDER_PIN_SESSION_SECRET '
      + '(or, during migration, SUPABASE_JWT_SECRET)',
    );
  }

  const session = {
    userId,
    exp: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
  };
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(session)));
  const sig = await hmacSign(payload, secret);
  return `${payload}.${sig}`;
}

/**
 * Verify a PIN session cookie. Returns session if valid + not expired.
 */
export async function verifyPinSession(cookieValue) {
  if (!cookieValue) return null;
  const secret = getPinSessionSecret();
  if (!secret) return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = await hmacSign(payload, secret);
  if (!constantTimeEqual(expected, sig)) return null;

  let session;
  try {
    session = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  } catch {
    return null;
  }

  if (typeof session.exp !== 'number' || session.exp * 1000 < Date.now()) return null;
  if (typeof session.userId !== 'string' || !session.userId) return null;

  return session;
}

/**
 * Build a Set-Cookie header value for the PIN session.
 */
export function buildSessionCookie(value, isProd = process.env.NODE_ENV === 'production') {
  const attrs = [
    `${SESSION_COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_TTL_MS / 1000}`,
  ];
  if (isProd) attrs.push('Secure');
  return attrs.join('; ');
}

export function buildLogoutCookie(isProd = process.env.NODE_ENV === 'production') {
  const attrs = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isProd) attrs.push('Secure');
  return attrs.join('; ');
}

export function readSessionCookieFromHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((s) => s.trim());
  for (const c of cookies) {
    if (c.startsWith(`${SESSION_COOKIE}=`)) return c.slice(SESSION_COOKIE.length + 1);
  }
  return null;
}

export const PIN_SESSION_COOKIE_NAME = SESSION_COOKIE;
