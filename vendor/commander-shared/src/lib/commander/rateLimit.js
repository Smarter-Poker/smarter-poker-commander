/**
 * Commander Rate Limiting — RE-EXPORT SHIM
 * ═══════════════════════════════════════════════════════════════
 * This file is a backward-compatible shim. All rate limiting logic
 * now lives in the canonical src/lib/apiRateLimit.js.
 *
 * Preserves the exact API signatures:
 *   - checkMemoryRateLimit(key, max, windowMs)
 *   - checkRateLimit(req, category)
 *   - withRateLimit(handler, category)
 *
 * Removes the dead DB-backed Supabase RPC path and the module-scope
 * createClient() call that violated SSG safety rules.
 * ═══════════════════════════════════════════════════════════════
 */

import { rateLimit, applyRateLimit, LIMITS } from '../apiRateLimit';

// Category-to-limits mapping (preserved from original)
const RATE_LIMITS = {
  default:      LIMITS.default,       // 60/min
  auth:         LIMITS.auth,          // 10/min
  write:        LIMITS.write,         // 30/min
  export:       { max: 5,  windowMs: 60 * 60 * 1000 },  // 5/hour
  notification: { max: 20, windowMs: 60_000 },           // 20/min
};

/**
 * In-memory rate limiter (drop-in replacement for original checkMemoryRateLimit).
 * @param {string} identifier - Unique key like "chksub:127.0.0.1"
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs - Window in ms
 * @returns {{ allowed: boolean, remaining: number, resetAt?: number, retryAfter?: number }}
 */
export function checkMemoryRateLimit(identifier, maxRequests = 60, windowMs = 60000) {
  const fakeReq = {
    headers: {},
    url: '/commander',
    socket: { remoteAddress: identifier },
  };
  const result = rateLimit(fakeReq, { max: maxRequests, windowMs, scope: `:cmdr:${identifier}` });
  return {
    allowed: result.ok,
    remaining: result.remaining,
    resetAt: result.reset,
    retryAfter: result.retryAfter,
  };
}

/**
 * Check rate limit using category-based limits.
 * @param {Object} req - Next.js request
 * @param {string} category - 'default' | 'auth' | 'write' | 'export' | 'notification'
 * @returns {{ allowed: boolean, limit: number, window: number }}
 */
export async function checkRateLimit(req, category = 'default') {
  const limits = RATE_LIMITS[category] || RATE_LIMITS.default;
  const result = rateLimit(req, { ...limits, scope: `:cmdr:${category}` });
  return {
    allowed: result.ok,
    limit: limits.max,
    window: Math.ceil(limits.windowMs / 60000),
    identifier: 'memory',
  };
}

/**
 * Rate limit middleware wrapper.
 * Usage: export default withRateLimit(handler, 'export');
 * @param {Function} handler - Next.js API handler
 * @param {string} category - Rate limit category
 * @returns {Function}
 */
export function withRateLimit(handler, category = 'default') {
  return async (req, res) => {
    const limits = RATE_LIMITS[category] || RATE_LIMITS.default;
    const allowed = applyRateLimit(req, res, { ...limits, scope: `:cmdr:${category}` });
    if (!allowed) return;
    return handler(req, res);
  };
}
