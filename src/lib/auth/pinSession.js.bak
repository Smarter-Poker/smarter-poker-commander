/**
 * Commander admin PIN session helper — server-side only.
 *
 * Phase 3.6 of the optimization plan replaces the legacy client-side
 * PIN gate (which left admin HTML visible without auth) with a
 * server-side cookie-based session.
 *
 * Cookie shape:
 *   commander_admin_session = base64url({userId, exp})
 *   Signed with HMAC-SHA256 using SUPABASE_JWT_SECRET (same secret
 *   used elsewhere — keeps secret count down).
 *
 * Lifecycle:
 *   - 30 min sliding window
 *   - HttpOnly + Secure + SameSite=Lax + Path=/commander/admin
 *   - Cleared on /api/admin/pin-logout
 */

const SESSION_COOKIE = 'commander_admin_session';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

interface PinSession {
  userId: string;
  exp: number; // unix seconds
}

function base64UrlEncode(bytes: Uint8Array): string {
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(message: string, secret: string): Promise<string> {
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

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Issue a new PIN session cookie value (signed). Caller must set the cookie
 * via res.setHeader('Set-Cookie', ...).
 */
export async function createPinSession(userId: string): Promise<string> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('[pinSession] SUPABASE_JWT_SECRET not configured');

  const session: PinSession = {
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
export async function verifyPinSession(cookieValue: string | undefined | null): Promise<PinSession | null> {
  if (!cookieValue) return null;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = await hmacSign(payload, secret);
  if (!constantTimeEqual(expected, sig)) return null;

  let session: PinSession;
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
export function buildSessionCookie(value: string, isProd = process.env.NODE_ENV === 'production'): string {
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

export function buildLogoutCookie(isProd = process.env.NODE_ENV === 'production'): string {
  const attrs = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isProd) attrs.push('Secure');
  return attrs.join('; ');
}

export function readSessionCookieFromHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((s) => s.trim());
  for (const c of cookies) {
    if (c.startsWith(`${SESSION_COOKIE}=`)) return c.slice(SESSION_COOKIE.length + 1);
  }
  return null;
}

export const PIN_SESSION_COOKIE_NAME = SESSION_COOKIE;
