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
 */

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
  const staffSession = req.headers?.['x-staff-session'];
  if (staffSession) {
    try {
      const parsed = JSON.parse(staffSession);
      const staffKey = parsed.id || parsed.user_id;
      if (staffKey) return 's:' + staffKey;
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
