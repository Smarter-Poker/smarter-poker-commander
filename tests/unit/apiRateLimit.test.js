/**
 * Rate-limit identity — regression cover for the 2026-07-26 audit fix.
 *
 * The previous implementation derived identity from `authorization.slice(7, 39)`,
 * commented as "the first 32 characters of the JWT". Every Supabase HS256 token
 * begins with the identical base64url header, so that slice was a constant and
 * every authenticated user shared ONE bucket per endpoint — a single busy
 * client could 429 an entire venue.
 *
 * The decisive test is `two different users do not share a bucket`: under the
 * old code both tokens produced the same key and the second user was rejected.
 */
import { describe, it, expect } from 'vitest';
import { rateLimit, LIMITS } from '../../src/lib/apiRateLimit';

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Build a realistic unsigned Supabase-shaped JWT for a given user id. */
const jwtFor = (sub) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, role: 'authenticated' })}.sig_${sub}`;

const reqWithToken = (sub, url = '/api/test') => ({
  headers: { authorization: `Bearer ${jwtFor(sub)}` },
  url,
});

describe('per-user bucketing', () => {
  it('two different users do not share a bucket', () => {
    const url = '/api/isolation-' + Math.random();
    const opts = { max: 2, windowMs: 60_000 };

    // Exhaust user A.
    expect(rateLimit(reqWithToken('user-aaa', url), opts).ok).toBe(true);
    expect(rateLimit(reqWithToken('user-aaa', url), opts).ok).toBe(true);
    expect(rateLimit(reqWithToken('user-aaa', url), opts).ok).toBe(false);

    // User B must be untouched. Under the old slice(7,39) identity this
    // returned false, because both tokens hashed to the same constant header.
    expect(rateLimit(reqWithToken('user-bbb', url), opts).ok).toBe(true);
  });

  it('tokens share an identical 32-char prefix, proving the old key was constant', () => {
    const a = jwtFor('user-aaa');
    const b = jwtFor('user-bbb');
    expect(a.slice(0, 32)).toBe(b.slice(0, 32));
    expect(a).not.toBe(b);
  });

  it('the same user is limited consistently across calls', () => {
    const url = '/api/same-user-' + Math.random();
    const opts = { max: 3, windowMs: 60_000 };
    const results = [1, 2, 3, 4].map(() => rateLimit(reqWithToken('user-ccc', url), opts).ok);
    expect(results).toEqual([true, true, true, false]);
  });
});

describe('bucket scoping', () => {
  it('separates buckets per endpoint', () => {
    const opts = { max: 1, windowMs: 60_000 };
    const tag = Math.random();
    expect(rateLimit(reqWithToken('user-ddd', `/api/one-${tag}`), opts).ok).toBe(true);
    expect(rateLimit(reqWithToken('user-ddd', `/api/two-${tag}`), opts).ok).toBe(true);
    expect(rateLimit(reqWithToken('user-ddd', `/api/one-${tag}`), opts).ok).toBe(false);
  });

  it('gives PIN terminals their own bucket via x-staff-session', () => {
    const url = '/api/staff-' + Math.random();
    const opts = { max: 1, windowMs: 60_000 };
    const staffReq = (id) => ({ headers: { 'x-staff-session': JSON.stringify({ id, venue_id: 7 }) }, url });
    expect(rateLimit(staffReq('staff-1'), opts).ok).toBe(true);
    expect(rateLimit(staffReq('staff-2'), opts).ok).toBe(true);   // different terminal
    expect(rateLimit(staffReq('staff-1'), opts).ok).toBe(false);  // same terminal
  });

  it('falls back to IP when unauthenticated', () => {
    const url = '/api/anon-' + Math.random();
    const opts = { max: 1, windowMs: 60_000 };
    const ipReq = (ip) => ({ headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` }, url });
    expect(rateLimit(ipReq('1.1.1.1'), opts).ok).toBe(true);
    expect(rateLimit(ipReq('2.2.2.2'), opts).ok).toBe(true);
    expect(rateLimit(ipReq('1.1.1.1'), opts).ok).toBe(false);
  });

  it('handles a malformed token without throwing, and still isolates it', () => {
    const url = '/api/malformed-' + Math.random();
    const opts = { max: 1, windowMs: 60_000 };
    const bad = (t) => ({ headers: { authorization: `Bearer ${t}` }, url });
    expect(rateLimit(bad('not-a-jwt'), opts).ok).toBe(true);
    expect(rateLimit(bad('also-not-a-jwt'), opts).ok).toBe(true);
    expect(rateLimit(bad('not-a-jwt'), opts).ok).toBe(false);
  });
});

describe('response shape', () => {
  it('reports remaining and retryAfter, and exposes the standard headers', () => {
    const url = '/api/shape-' + Math.random();
    const first = rateLimit(reqWithToken('user-eee', url), { max: 1, windowMs: 60_000 });
    expect(first.remaining).toBe(0);
    expect(first.headers['X-RateLimit-Limit']).toBe('1');

    const second = rateLimit(reqWithToken('user-eee', url), { max: 1, windowMs: 60_000 });
    expect(second.ok).toBe(false);
    expect(second.retryAfter).toBeGreaterThan(0);
  });

  it('ships the documented limit tiers', () => {
    expect(LIMITS.write.max).toBe(30);
    expect(LIMITS.read.max).toBe(120);
    expect(LIMITS.auth.max).toBe(10);
  });
});
