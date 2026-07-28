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

// The signing secret must exist before anything signs or verifies a session.
// auth.js reads it lazily (inside sessionSecret()), so setting it here is enough.
process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'test-signing-secret';

import { rateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { signStaffSession } from '../../src/lib/commander/auth';

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

  it('gives validly-SIGNED PIN terminals their own bucket via x-staff-session', () => {
    const url = '/api/staff-' + Math.random();
    const opts = { max: 1, windowMs: 60_000 };
    // Real signatures, produced by the same helper the server issues sessions with.
    const staffReq = (id) => ({
      headers: {
        'x-staff-session': JSON.stringify(signStaffSession({ id, venue_id: 7, role: 'floor' })),
      },
      url,
    });
    expect(rateLimit(staffReq('staff-1'), opts).ok).toBe(true);
    expect(rateLimit(staffReq('staff-2'), opts).ok).toBe(true);   // different terminal
    expect(rateLimit(staffReq('staff-1'), opts).ok).toBe(false);  // same terminal
  });

  /**
   * Regression cover for the 2026-07-28 audit fix.
   *
   * This file previously asserted that UNSIGNED session headers each got their
   * own bucket — it encoded the bug. Nothing validates x-staff-session on an
   * unauthenticated route, so an attacker sending a fresh {"id":"<random>"} per
   * request was handed a fresh 30/min allowance every time and was never
   * limited at all. Forged identities must now collapse onto the IP key.
   */
  it('collapses forged/unsigned staff sessions into the caller IP bucket', () => {
    const url = '/api/forged-' + Math.random();
    const opts = { max: 2, windowMs: 60_000 };
    // A new made-up staff id on every request, all from one IP.
    const forged = (id) => ({
      headers: {
        'x-staff-session': JSON.stringify({ id, venue_id: 7, session_ts: Date.now() }),
        'x-forwarded-for': '9.9.9.9',
      },
      url,
    });
    expect(rateLimit(forged('forged-1'), opts).ok).toBe(true);
    expect(rateLimit(forged('forged-2'), opts).ok).toBe(true);
    // Under the old code this minted a third bucket and stayed true forever.
    expect(rateLimit(forged('forged-3'), opts).ok).toBe(false);
    expect(rateLimit(forged('forged-4'), opts).ok).toBe(false);
  });

  it('rejects a TAMPERED signature and falls back to the IP bucket', () => {
    const url = '/api/tampered-' + Math.random();
    const opts = { max: 1, windowMs: 60_000 };
    // Sign as staff-9, then swap the id — the sig no longer covers the payload.
    const tampered = (id) => {
      const signed = signStaffSession({ id: 'staff-9', venue_id: 7, role: 'floor' });
      return {
        headers: {
          'x-staff-session': JSON.stringify({ ...signed, id }),
          'x-forwarded-for': '8.8.8.8',
        },
        url,
      };
    };
    expect(rateLimit(tampered('attacker-a'), opts).ok).toBe(true);
    expect(rateLimit(tampered('attacker-b'), opts).ok).toBe(false); // same IP bucket
  });

  it('a signed session and a forgery of it do not share an identity', () => {
    const url = '/api/mixed-' + Math.random();
    const opts = { max: 1, windowMs: 60_000 };
    const signed = {
      headers: { 'x-staff-session': JSON.stringify(signStaffSession({ id: 'staff-real', venue_id: 7, role: 'floor' })) },
      url,
    };
    const forgedAsSameId = {
      headers: {
        'x-staff-session': JSON.stringify({ id: 'staff-real', venue_id: 7, session_ts: Date.now() }),
        'x-forwarded-for': '7.7.7.7',
      },
      url,
    };
    // The forgery must NOT be able to spend the real terminal's allowance,
    // nor borrow its identity: it is keyed on 7.7.7.7 instead.
    expect(rateLimit(forgedAsSameId, opts).ok).toBe(true);
    expect(rateLimit(signed, opts).ok).toBe(true);
    expect(rateLimit(signed, opts).ok).toBe(false);
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
