/**
 * Staff session integrity — regression cover for the 2026-07-25 audit P0.
 *
 * verifyStaffSession used to trust the raw `x-staff-session` JSON header as
 * sent by the client. Anyone who learned a venue id and a user id — both of
 * which leak through ordinary endpoints — could mint an owner session for any
 * venue and get full manager access. Sessions are now HMAC-signed server-side
 * and rejected unless the signature verifies.
 *
 * Every case below returns before any database call (signature and TTL checks
 * run first), so this suite needs no Supabase connection.
 */
import { describe, it, expect, beforeAll } from 'vitest';

process.env.SUPABASE_JWT_SECRET = 'test-signing-secret-for-unit-tests';

let signStaffSession;
let verifyStaffSession;
let renewOwnerSession;
let STAFF_SESSION_TTLS;

beforeAll(async () => {
  const mod = await import('../../src/lib/commander/auth');
  signStaffSession = mod.signStaffSession;
  verifyStaffSession = mod.verifyStaffSession;
  renewOwnerSession = mod.renewOwnerSession;
  STAFF_SESSION_TTLS = mod.STAFF_SESSION_TTLS;
});

const asHeader = (session) => ({ headers: { 'x-staff-session': JSON.stringify(session) } });

describe('signStaffSession', () => {
  it('stamps a signature and a timestamp', () => {
    const s = signStaffSession({ id: 'staff-1', venue_id: 42, role: 'floor' });
    expect(typeof s.sig).toBe('string');
    expect(s.sig.length).toBeGreaterThan(32);
    expect(typeof s.session_ts).toBe('number');
    expect(s.role).toBe('floor');
  });

  it('produces different signatures for different claims', () => {
    const ts = Date.now();
    const floor = signStaffSession({ id: 'staff-1', venue_id: 42, role: 'floor', session_ts: ts });
    const owner = signStaffSession({ id: 'staff-1', venue_id: 42, role: 'owner', session_ts: ts });
    expect(floor.sig).not.toBe(owner.sig);
  });
});

describe('verifyStaffSession rejects anything it did not sign', () => {
  it('rejects a missing header', async () => {
    const r = await verifyStaffSession({ headers: {} });
    expect(r.error?.code).toBe('AUTH_REQUIRED');
  });

  it('rejects malformed JSON', async () => {
    const r = await verifyStaffSession({ headers: { 'x-staff-session': '{not json' } });
    expect(r.error?.code).toBe('INVALID_SESSION');
  });

  it('rejects a hand-crafted unsigned session — the original attack', async () => {
    // Exactly what an attacker could previously send to become an owner.
    const forged = { user_id: 'victim-user-id', venue_id: 42, role: 'owner', session_ts: Date.now() };
    const r = await verifyStaffSession(asHeader(forged));
    expect(r.staff).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it('rejects a session carrying a bogus signature', async () => {
    const forged = { id: 'staff-1', venue_id: 42, role: 'owner', session_ts: Date.now(), sig: 'deadbeef'.repeat(8) };
    const r = await verifyStaffSession(asHeader(forged));
    expect(r.staff).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it('rejects privilege escalation on a legitimately signed session', async () => {
    const signed = signStaffSession({ id: 'staff-1', venue_id: 42, role: 'floor' });
    const escalated = { ...signed, role: 'owner' }; // keep the valid sig, change the claim
    const r = await verifyStaffSession(asHeader(escalated));
    expect(r.staff).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it('rejects venue swapping on a legitimately signed session', async () => {
    const signed = signStaffSession({ id: 'staff-1', venue_id: 42, role: 'manager' });
    const crossVenue = { ...signed, venue_id: 99 };
    const r = await verifyStaffSession(asHeader(crossVenue));
    expect(r.staff).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it('rejects a PIN session older than the 12 hour TTL', async () => {
    const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
    const stale = signStaffSession({ id: 'staff-1', venue_id: 42, role: 'floor', session_ts: thirteenHoursAgo });
    const r = await verifyStaffSession(asHeader(stale));
    expect(r.error?.code).toBe('SESSION_EXPIRED');
  });

  it('rejects an owner session older than the 7 day TTL', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const stale = signStaffSession({ user_id: 'owner-1', venue_id: 42, role: 'owner', session_ts: eightDaysAgo });
    const r = await verifyStaffSession(asHeader(stale));
    expect(r.error?.code).toBe('SESSION_EXPIRED');
  });
});

describe('owner TTL is 24h and renewal is cheap but strict (2026-09-04)', () => {
  it('exposes the constants the client mirrors', () => {
    expect(STAFF_SESSION_TTLS.OWNER_SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(STAFF_SESSION_TTLS.OWNER_SESSION_RENEW_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
  });

  it('rejects an owner session older than 24h', async () => {
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
    const stale = signStaffSession({ user_id: 'owner-1', venue_id: 42, role: 'owner', session_ts: twentyFiveHoursAgo });
    const r = await verifyStaffSession(asHeader(stale));
    expect(r.error?.code).toBe('SESSION_EXPIRED');
  });

  it('renews an EXPIRED but authentic owner session for the same user, without a DB', () => {
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
    const stale = signStaffSession({ user_id: 'owner-1', venue_id: 42, role: 'owner', session_ts: twentyFiveHoursAgo });
    const renewed = renewOwnerSession(stale, 'owner-1');
    expect(renewed.error).toBeUndefined();
    expect(renewed.user_id).toBe('owner-1');
    expect(renewed.venue_id).toBe(42);
    expect(renewed.session_ts).toBeGreaterThan(twentyFiveHoursAgo);
    expect(renewed.sig).not.toBe(stale.sig);
  });

  it('refuses to renew a tampered session, a different user, a PIN session, or one past the 48h window', () => {
    const fresh = signStaffSession({ user_id: 'owner-1', venue_id: 42, role: 'owner' });
    expect(renewOwnerSession({ ...fresh, venue_id: 99 }, 'owner-1').error?.code).toBe('SESSION_EXPIRED');
    expect(renewOwnerSession(fresh, 'someone-else').error?.code).toBe('FORBIDDEN');
    const pin = signStaffSession({ id: 'staff-1', venue_id: 42, role: 'floor' });
    expect(renewOwnerSession(pin, 'owner-1').error?.code).toBe('NOT_RENEWABLE');
    const old = signStaffSession({ user_id: 'owner-1', venue_id: 42, role: 'owner', session_ts: Date.now() - 49 * 60 * 60 * 1000 });
    expect(renewOwnerSession(old, 'owner-1').error?.code).toBe('RENEW_WINDOW_PASSED');
    expect(renewOwnerSession(null, 'owner-1').error?.code).toBe('INVALID_SESSION');
  });
});
