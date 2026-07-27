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

beforeAll(async () => {
  const mod = await import('../../src/lib/commander/auth');
  signStaffSession = mod.signStaffSession;
  verifyStaffSession = mod.verifyStaffSession;
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
