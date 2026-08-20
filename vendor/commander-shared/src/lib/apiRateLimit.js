/**
 * apiRateLimit.js - Production-ready in-memory rate limiter
 * 
 * Uses a sliding window counter per (identifier + endpoint) key.
 * Automatically cleans up expired entries every 5 minutes.
 * 
 * Usage:
 *   import { rateLimit } from '../../src/lib/apiRateLimit';
 *
 *   export default async function handler(req, res) {
 *     const limit = rateLimit(req, { max: 10, windowMs: 60_000 });
 *     if (!limit.ok) return res.status(429).json({ error: 'Too many requests' });
 *     ...
 *   }
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

function getIdentifier(req) {
  // Prefer authenticated user ID from JWT (first 32 chars of token)
  const auth = req.headers?.authorization;
  if (auth?.startsWith('Bearer ')) {
    return 'u:' + auth.slice(7, 39);
  }
  // Fall back to IP
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
 * Convenience wrapper.
 * @returns {boolean} true if request is allowed, false if rejected (and response sent)
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
  ai:        { max: 5,  windowMs: 60_000 },       // 5/min - AI generation
  upload:    { max: 10, windowMs: 60_000 },        // 10/min - file uploads
  financial: { max: 20, windowMs: 60_000 },        // 20/min - financial ops
  auth:      { max: 10, windowMs: 60_000 },        // 10/min - auth attempts
  write:     { max: 30, windowMs: 60_000 },        // 30/min - write ops
  read:      { max: 120, windowMs: 60_000 },       // 120/min - read ops
  default:   { max: 60, windowMs: 60_000 },        // 60/min - everything else
};
