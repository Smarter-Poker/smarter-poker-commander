/**
 * apiRateLimit.js — Commander-local override (2026-07-26 audit follow-up).
 *
 * This file previously re-exported the shared package verbatim. It now owns a
 * corrected implementation, following the same local-override pattern already
 * used by src/lib/commander/auth.js. Every API route already imports this
 * local path, so no call sites change.
 *
 * THE BUG THIS FIXES
 * ------------------
 * The shared implementation derived rate-limit identity from
 * `authorization.slice(7, 39)` — "the first 32 characters of the JWT". Every
 * Supabase HS256 token begins with the SAME base64url-encoded header
 * (eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9), so those 32 characters are a
 * constant. Every authenticated user therefore shared ONE bucket per endpoint:
 * a single busy client could 429 an entire venue, and an abusive client was
 * only ever limited jointly with everyone else.
 *
 * Identity is now the JWT `sub` claim (the Supabase user id), falling back to a
 * hash of the whole token if the payload cannot be decoded, then to IP.
 *
 * Public API (rateLimit, applyRateLimit, LIMITS) is unchanged.
 *
 * 2026-07-28 audit fix: the staff-session branch of getIdentifier trusted the
 * raw x-staff-session JSON. On an unauthenticated route nothing validates that
 * header, so an attacker could send a fresh {"id":"<random>"} on every request
 * and mint a brand-new bucket each time — unlimited requests. The signature is
 * now verified before the session is allowed to name its own bucket.
 */
import crypto from 'crypto';
import { signStaffSession } from './commander/auth';

const store = new Map();

// Clean up expired entries every 5 min
if (typeof setInterval !== 'undefined') {
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.reset) store.delete(key);
    }
  }, 5 * 60 * 1000);
  if (interval.unref) interval.unref();
}

/** Decode a base64url segment to a UTF-8 string in both Node and edge runtimes. */
function decodeSegment(seg) {
  const padded = seg.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  if (typeof atob === 'function') {
    return decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  }
  return '';
}

/** Pull the `sub` (user id) claim out of a JWT without verifying it. */
function subjectFromJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(decodeSegment(parts[1]));
    const sub = payload && payload.sub;
    return typeof sub === 'string' && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

/** Stable non-cryptographic fallback so distinct tokens still get distinct buckets. */
function hashToken(token) {
  let h = 5381;
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Is this x-staff-session genuinely signed by us?
 *
 * getIdentifier is SYNCHRONOUS (it runs on every request, before any await), so
 * this cannot call the async verifyStaffSession. Instead it recomputes the HMAC
 * through signStaffSession — the same helper that issues sessions — which keeps
 * the canonical-string construction and secret resolution in exactly one place
 * (src/lib/commander/auth.js) rather than duplicating them here.
 */
function staffSessionIsAuthentic(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (!parsed.sig || !parsed.session_ts) return false;
  try {
    const expected = signStaffSession(parsed).sig;
    const a = Buffer.from(String(parsed.sig), 'utf8');
    const b = Buffer.from(String(expected), 'utf8');
    // timingSafeEqual throws on unequal-length buffers — check length first.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getIdentifier(req) {
  const auth = req.headers?.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) {
      const sub = subjectFromJwt(token);
      return 'u:' + (sub || 'h' + hashToken(token));
    }
  }
  // Staff terminals authenticate by signed session rather than JWT; key them
  // on the staff row so one terminal cannot starve the rest of the venue.
  // 2026-07-28 audit fix: ONLY a session whose HMAC actually verifies may name
  // its own bucket. Forged, unsigned and tampered sessions fall through to the
  // IP key below, so they all share one bucket instead of minting new ones.
  const staffSession = req.headers?.['x-staff-session'];
  if (staffSession) {
    try {
      const parsed = JSON.parse(staffSession);
      if (staffSessionIsAuthentic(parsed)) {
        const staffKey = parsed.id || parsed.user_id;
        if (staffKey) return 's:' + staffKey;
      }
    } catch {
      /* fall through to IP */
    }
  }
  const forwarded = req.headers?.['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || 'unknown');
  return 'ip:' + ip;
}

/**
 * Check and increment rate limit counter.
 * @param {object} req - Next.js request
 * @param {object} opts
 * @param {number} opts.max      - max requests per window (default: 60)
 * @param {number} opts.windowMs - window in milliseconds (default: 60000)
 * @param {string} opts.scope    - optional scope suffix to namespace limits
 * @returns {{ ok: boolean, remaining: number, reset: number, retryAfter?: number }}
 */
export function rateLimit(req, { max = 60, windowMs = 60_000, scope = '' } = {}) {
  const id = getIdentifier(req);
  const endpoint = (req.url?.split('?')[0] || '') + scope;
  const key = `${id}::${endpoint}`;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + windowMs };
  }

  entry.count++;
  store.set(key, entry);

  const remaining = Math.max(0, max - entry.count);
  const ok = entry.count <= max;

  return {
    ok,
    remaining,
    reset: entry.reset,
    retryAfter: ok ? undefined : Math.ceil((entry.reset - now) / 1000),
    headers: {
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.floor(entry.reset / 1000)),
    },
  };
}

/**
 * Apply rate limit headers to response and return 429 if exceeded.
 * @returns {boolean} true if request is allowed, false if rejected (response sent)
 */
export function applyRateLimit(req, res, opts = {}) {
  const result = rateLimit(req, opts);
  Object.entries(result.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  if (!result.ok) {
    if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter));
    res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: result.retryAfter,
    });
    return false;
  }
  return true;
}

// Pre-defined limit tiers
export const LIMITS = {
  ai:        { max: 5,  windowMs: 60_000 },       // 5/min
  upload:    { max: 10, windowMs: 60_000 },       // 10/min
  financial: { max: 20, windowMs: 60_000 },       // 20/min
  auth:      { max: 10, windowMs: 60_000 },       // 10/min
  write:     { max: 30, windowMs: 60_000 },       // 30/min
  read:      { max: 120, windowMs: 60_000 },      // 120/min
  default:   { max: 60, windowMs: 60_000 },       // 60/min
};
