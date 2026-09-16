/**
 * /api/internal/login-bridge-probe - the Open Claw entry point for the probe.
 * The probe core and database are mocked; what is under test is the contract the
 * dispatcher relies on: bearer auth, loud 503 when unconfigured, 200/500 by
 * probe outcome, and retained local diagnostics on failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mintProbeTicket, verifyProbeTicket } from '../../src/lib/probe/ticket.js';

const probeResult = { current: null };

vi.mock('../../src/lib/probe/loginBridgeProbe.mjs', () => ({
  runLoginBridgeProbe: vi.fn(async (opts) => {
    probeResult.opts = opts;
    return probeResult.current;
  }),
}));
const db = { inserts: [] };
vi.mock('../../src/lib/supabaseServerClient', () => ({
  createClient: () => ({
    from: (table) => ({
      insert: (row) => ({
        abortSignal: async () => { db.inserts.push({ table, row }); return { error: null }; },
      }),
    }),
  }),
}));

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const req = (auth, method = 'GET') => ({ method, headers: auth ? { authorization: auth } : {} });

let handler;
beforeEach(async () => {
  vi.resetModules();
  db.inserts = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.CRON_SECRET = 'top-secret';
  process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
  process.env.PROBE_LOGIN_EMAIL = 'probe@example.com';
  process.env.PROBE_LOGIN_PASSWORD = 'pw';
  probeResult.current = {
    ok: true, results: [{ leg: 'structural', name: 'a', ok: true, detail: '', warnOnly: false }],
    failures: [], warnings: [], markdown: '## ok',
  };
  handler = (await import('../../pages/api/internal/login-bridge-probe.js')).default;
});

describe('/api/internal/login-bridge-probe', () => {
  it('rejects non-GET', async () => {
    const res = mockRes();
    await handler(req('Bearer top-secret', 'POST'), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 503 (never a silent pass) when neither secret is configured', async () => {
    delete process.env.CRON_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;
    const res = mockRes();
    await handler(req('Bearer anything'), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/CRON_SECRET/);
  });

  it('accepts a fresh hub ticket signed with SUPABASE_JWT_SECRET, without any CRON_SECRET', async () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    const r = req(undefined);
    r.headers['x-probe-ticket'] = mintProbeTicket('jwt-secret');
    await handler(r, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.auth).toBe('hub-ticket');
  });

  it('rejects a stale, forged or malformed ticket with 401', async () => {
    for (const [label, t] of [
      ['stale', mintProbeTicket('jwt-secret', Date.now() - 10 * 60 * 1000)],
      ['future', mintProbeTicket('jwt-secret', Date.now() + 10 * 60 * 1000)],
      ['forged', mintProbeTicket('other-secret')],
      ['malformed', 'v1.abc.def'],
    ]) {
      const res = mockRes();
      const r = req(undefined);
      r.headers['x-probe-ticket'] = t;
      await handler(r, res);
      expect(res.statusCode, label).toBe(401);
    }
    expect(db.inserts).toHaveLength(0);
  });

  it('rejects a missing or wrong bearer with 401', async () => {
    for (const a of [undefined, 'Bearer nope', 'Basic top-secret', 'Bearer top-secret-longer']) {
      const res = mockRes();
      await handler(req(a), res);
      expect(res.statusCode, `auth=${a}`).toBe(401);
    }
  });

  it('runs the probe with the project credentials and returns 200 on success', async () => {
    const res = mockRes();
    await handler(req('Bearer top-secret'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, passed: 1, failed: 0 });
    expect(probeResult.opts).toMatchObject({ email: 'probe@example.com', password: 'pw' });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toContain('pw');
    // The hub's cron watchdogs read cron_execution_log; this run is visible there.
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].table).toBe('cron_execution_log');
    expect(db.inserts[0].row).toMatchObject({ job_name: '/commander/internal/login-bridge-probe', status: 'success' });
    expect(JSON.stringify(db.inserts[0].row)).not.toContain('pw');
  });

  it('does not record unauthorized hits as runs (strangers probing the URL)', async () => {
    const res = mockRes();
    await handler(req('Bearer nope'), res);
    expect(res.statusCode).toBe(401);
    expect(db.inserts).toHaveLength(0);
  });

  it('returns 500 with the failing rows and records failure in the existing health log', async () => {
    probeResult.current = {
      ok: false,
      results: [{ leg: 'signed-in', name: 'grant', ok: false, detail: 'status=400', warnOnly: false }],
      failures: [{ leg: 'signed-in', name: 'grant', ok: false, detail: 'status=400', warnOnly: false }],
      warnings: [], markdown: '## 1 FAILED',
    };
    const res = mockRes();
    await handler(req('Bearer top-secret'), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.failures).toEqual([{ leg: 'signed-in', name: 'grant', detail: 'status=400' }]);
    expect(res.body.signed_in_leg).toBe(true);
    expect(db.inserts[0].row).toMatchObject({ job_name: '/commander/internal/login-bridge-probe', status: 'error' });
    expect(db.inserts[0].row.error).toMatch(/grant - status=400/);
  });
});

describe('probe ticket (shared with the World Hub relay - identical file, identical vector)', () => {
  it('mints the pinned vector and verifies it in constant time', () => {
    // The same vector is pinned in the World Hub's tests/probe-ticket.test.mjs.
    // If either side changes the format, one of the two goes red.
    const t = mintProbeTicket('k', 1700000000000);
    expect(t).toBe('v1.1700000000000.9ae520ae96223798a843414cee48929719c33d937ec319ea13e13512a55bdfb1');
    expect(verifyProbeTicket(t, 'k', 1700000000000)).toEqual({ ok: true, ts: 1700000000000 });
    expect(verifyProbeTicket(t, 'k', 1700000000000 + 4 * 60 * 1000).ok).toBe(true);
    expect(verifyProbeTicket(t, 'k', 1700000000000 + 6 * 60 * 1000)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyProbeTicket(t, 'not-k', 1700000000000)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyProbeTicket(t, '', 1700000000000)).toEqual({ ok: false, reason: 'no_secret' });
    expect(verifyProbeTicket(undefined, 'k')).toEqual({ ok: false, reason: 'malformed' });
  });
});
