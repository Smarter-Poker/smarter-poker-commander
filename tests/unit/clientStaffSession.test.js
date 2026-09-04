/**
 * Client staff-session lifecycle - regression cover for the 2026-09-03
 * "Commander asks me to sign in again and then refuses the login" incident.
 *
 * The browser-side module under test is dependency-free (fetch + localStorage
 * only), so it runs here against a tiny fake DOM. Every case pins a behaviour
 * that, when it was missing, produced a login page nobody could get past:
 *   - a stale / unsigned / hand-edited staff session is detected as unhealthy
 *   - refreshStaffSession() re-mints it from the live Supabase token, once,
 *     no matter how many panels 401 at the same instant
 *   - the venue the client is on is what gets re-signed (club switcher)
 *   - PIN terminals are never touched (they have no Supabase user)
 *   - completeCommanderLogin() stores the SERVER-issued signed session and
 *     navigates; it never hand-writes a venue_id/role of its own
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

let mod;
let fetchCalls;
let subscriptionResponse;
let renewResponse;

beforeEach(async () => {
  vi.resetModules();
  globalThis.localStorage = fakeStorage();
  globalThis.sessionStorage = fakeStorage();
  globalThis.window = globalThis;
  globalThis.location = { origin: 'https://commander.smarter.poker', href: '', pathname: '/commander/dashboard' };
  globalThis.CustomEvent = class CustomEvent { constructor(type, o) { this.type = type; this.detail = o?.detail; } };
  globalThis.dispatchEvent = vi.fn();

  fetchCalls = [];
  subscriptionResponse = () => ({
    ok: true,
    status: 200,
    json: async () => ({
      subscription: { venue_id: 77, venue: { name: 'Test Room' }, tier: 'pro' },
      staff_session: { user_id: 'u1', venue_id: 77, role: 'owner', session_ts: Date.now(), sig: 'server-sig' },
    }),
  });
  renewResponse = () => ({ ok: false, status: 401, json: async () => ({ error: 'no' }) });
  globalThis.fetch = vi.fn(async (url, opts) => {
    fetchCalls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
    if (url.includes('/staff-session/renew')) return renewResponse();
    return subscriptionResponse();
  });

  mod = await import('../../vendor/commander-shared/src/lib/commander/staffSession.js');
});

const withHubSession = () =>
  localStorage.setItem('smarter-poker-auth', JSON.stringify({ access_token: 'tok', user: { id: 'u1', email: 'a@b.c' } }));

describe('isStaffSessionHealthy', () => {
  it('is false with no session', () => {
    expect(mod.isStaffSessionHealthy()).toBe(false);
  });
  it('is false for an unsigned session (pre-2026-07-25 shape)', () => {
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner' }));
    expect(mod.isStaffSessionHealthy()).toBe(false);
  });
  it('is false when the 24h owner TTL is nearly spent, so we refresh BEFORE the server rejects it', () => {
    const twentyOneHours = Date.now() - 21 * 60 * 60 * 1000;
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner', sig: 'x', session_ts: twentyOneHours }));
    expect(mod.isStaffSessionHealthy()).toBe(false);
    const nineteenHours = Date.now() - 19 * 60 * 60 * 1000;
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner', sig: 'x', session_ts: nineteenHours }));
    expect(mod.isStaffSessionHealthy()).toBe(true);
  });
  it('is true for a fresh signed owner session', () => {
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner', sig: 'x', session_ts: Date.now() }));
    expect(mod.isStaffSessionHealthy()).toBe(true);
  });
  it('leaves PIN terminal sessions alone', () => {
    localStorage.setItem('commander_staff', JSON.stringify({ id: 'staff-row', venue_id: 77, role: 'floor', sig: 'x', session_ts: 1 }));
    expect(mod.isStaffSessionHealthy()).toBe(true);
  });
});

describe('refreshStaffSession', () => {
  it('re-mints from the live token and stores the SERVER-signed session', async () => {
    withHubSession();
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner' }));
    expect(await mod.refreshStaffSession()).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('/api/commander/check-subscription');
    expect(fetchCalls[0].auth).toBe('Bearer tok');
    const stored = JSON.parse(localStorage.getItem('commander_staff'));
    expect(stored.sig).toBe('server-sig');
    expect(stored.email).toBe('a@b.c');
    expect(mod.isStaffSessionHealthy()).toBe(true);
    expect(globalThis.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent 401s into ONE network call', async () => {
    withHubSession();
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner' }));
    const results = await Promise.all([mod.refreshStaffSession(), mod.refreshStaffSession(), mod.refreshStaffSession()]);
    expect(results).toEqual([true, true, true]);
    expect(fetchCalls).toHaveLength(1);
  });

  it('honours the cooldown unless forced', async () => {
    withHubSession();
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner' }));
    expect(await mod.refreshStaffSession()).toBe(true);
    expect(await mod.refreshStaffSession()).toBe(false);
    expect(fetchCalls).toHaveLength(1);
    expect(await mod.refreshStaffSession({ force: true })).toBe(true);
    // second, forced refresh: renew is tried first (mock refuses), then the full path
    expect(fetchCalls.filter((c) => c.url.includes('check-subscription'))).toHaveLength(2);
  });

  it('re-signs for the venue the client is on (club switcher edited venue_id)', async () => {
    withHubSession();
    localStorage.setItem('commander_active_venue_id', '77');
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 99, role: 'owner', sig: 'now-invalid', session_ts: Date.now() }));
    await mod.refreshStaffSession();
    const sub = fetchCalls.find((c) => c.url.includes('check-subscription'));
    expect(sub.body.preferred_venue_id).toBe(99);
  });

  it('never touches a PIN terminal session', async () => {
    withHubSession();
    localStorage.setItem('commander_staff', JSON.stringify({ id: 'staff-row', venue_id: 77, role: 'floor', sig: 'x', session_ts: 1 }));
    expect(await mod.refreshStaffSession({ force: true })).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  it('returns false without a live token (truly signed out)', async () => {
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner' }));
    expect(await mod.refreshStaffSession({ force: true })).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  it('clears dead commander state on a definitive 404 (no subscription)', async () => {
    withHubSession();
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner' }));
    localStorage.setItem('commander_venue', '{"id":77}');
    subscriptionResponse = () => ({ ok: false, status: 404, json: async () => ({ error: 'No active subscription found' }) });
    expect(await mod.refreshStaffSession({ force: true })).toBe(false);
    expect(localStorage.getItem('commander_venue')).toBeNull();
  });
});

describe('renew-first self-heal', () => {
  it('re-signs an authentic expired session via /staff-session/renew and never touches check-subscription', async () => {
    withHubSession();
    const stale = { user_id: 'u1', venue_id: 77, role: 'owner', sig: 'authentic-but-expired', session_ts: Date.now() - 25 * 60 * 60 * 1000, venue_name: 'Test Room' };
    localStorage.setItem('commander_staff', JSON.stringify(stale));
    renewResponse = () => ({ ok: true, status: 200, json: async () => ({ staff_session: { user_id: 'u1', venue_id: 77, role: 'owner', session_ts: Date.now(), sig: 'renewed-sig' } }) });
    expect(await mod.refreshStaffSession({ force: true })).toBe(true);
    expect(fetchCalls.map((c) => c.url)).toEqual(['/api/commander/staff-session/renew']);
    expect(fetchCalls[0].body.session.sig).toBe('authentic-but-expired');
    const stored = JSON.parse(localStorage.getItem('commander_staff'));
    expect(stored.sig).toBe('renewed-sig');
    expect(stored.venue_name, 'display fields survive a renew').toBe('Test Room');
    expect(globalThis.dispatchEvent.mock.calls[0][0].detail.via).toBe('renew');
  });

  it('falls back to check-subscription when renew refuses (tampered, too old, wrong user)', async () => {
    withHubSession();
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner', sig: 'tampered', session_ts: Date.now() }));
    expect(await mod.refreshStaffSession({ force: true })).toBe(true);
    expect(fetchCalls.map((c) => c.url)).toEqual(['/api/commander/staff-session/renew', '/api/commander/check-subscription']);
    expect(JSON.parse(localStorage.getItem('commander_staff')).sig).toBe('server-sig');
  });

  it('skips renew entirely for an unsigned session, a switched venue, or one past 48h', async () => {
    withHubSession();
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner' }));
    await mod.refreshStaffSession({ force: true });
    expect(fetchCalls.map((c) => c.url)).toEqual(['/api/commander/check-subscription']);
    fetchCalls.length = 0;
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner', sig: 'x', session_ts: Date.now() - 49 * 60 * 60 * 1000 }));
    await mod.refreshStaffSession({ force: true });
    expect(fetchCalls.map((c) => c.url)).toEqual(['/api/commander/check-subscription']);
  });
});

describe('access-token provider (expired-token self-heal)', () => {
  it('prefers a registered provider over the cached localStorage token', async () => {
    withHubSession(); // cached token = 'tok'
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: 'u1', venue_id: 77, role: 'owner' }));
    mod.setAccessTokenProvider(async () => 'fresh-tok');
    expect(await mod.currentAccessToken()).toBe('fresh-tok');
    expect(await mod.refreshStaffSession({ force: true })).toBe(true);
    expect(fetchCalls[0].auth).toBe('Bearer fresh-tok');
  });

  it('falls back to the cached token when the provider throws or returns nothing', async () => {
    withHubSession();
    mod.setAccessTokenProvider(async () => { throw new Error('sdk not ready'); });
    expect(await mod.currentAccessToken()).toBe('tok');
    mod.setAccessTokenProvider(async () => '');
    expect(await mod.currentAccessToken()).toBe('tok');
    mod.setAccessTokenProvider(null);
    expect(await mod.currentAccessToken()).toBe('tok');
  });
});

describe('completeCommanderLogin', () => {
  it('stores the server session and navigates to the dashboard', async () => {
    const r = await mod.completeCommanderLogin({ id: 'u1', email: 'a@b.c' }, 'tok');
    expect(r).toBe(true);
    expect(location.href).toBe('/commander/dashboard');
    expect(localStorage.getItem('commander_remember')).toBe('true');
    expect(JSON.parse(localStorage.getItem('commander_staff')).sig).toBe('server-sig');
  });

  it('honours a stashed Commander return URL but never bounces back to login', async () => {
    sessionStorage.setItem('commander_return_url', '/commander/login?expired=1');
    await mod.completeCommanderLogin({ id: 'u1' }, 'tok');
    expect(location.href).toBe('/commander/dashboard');
    sessionStorage.setItem('commander_return_url', '/commander/tables');
    await mod.completeCommanderLogin({ id: 'u1' }, 'tok');
    expect(location.href).toBe('/commander/tables');
  });

  it('surfaces the server error instead of navigating', async () => {
    subscriptionResponse = () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await mod.completeCommanderLogin({ id: 'u1' }, 'tok');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No Active Club Commander Subscription/);
    expect(location.href).toBe('');
  });

  it('refuses to proceed without a token', async () => {
    const r = await mod.completeCommanderLogin({ id: 'u1' }, '');
    expect(r.ok).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });
});
