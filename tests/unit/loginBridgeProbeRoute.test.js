/**
 * /api/internal/login-bridge-probe - the Open Claw entry point for the probe.
 * The probe core and Sentry are mocked; what is under test is the contract the
 * dispatcher relies on: bearer auth, loud 503 when unconfigured, 200/500 by
 * probe outcome, and a Sentry signal on failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const probeResult = { current: null };
const sentry = { captured: [], scope: null };

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
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn) => {
    const tags = {}; const extra = {};
    const scope = {
      setTag: (k, v) => { tags[k] = v; },
      setExtra: (k, v) => { extra[k] = v; },
      setLevel: vi.fn(),
      setFingerprint: vi.fn(),
    };
    sentry.scope = { tags, extra };
    fn(scope);
  },
  captureMessage: (msg, level) => { sentry.captured.push({ msg, level, ...sentry.scope }); },
  flush: vi.fn(async () => true),
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
  sentry.captured = [];
  db.inserts = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.CRON_SECRET = 'top-secret';
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

  it('answers 503 (never a silent pass) when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    await handler(req('Bearer anything'), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/CRON_SECRET/);
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
    expect(sentry.captured).toHaveLength(0);
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

  it('returns 500 with the failing rows and reports to Sentry on failure', async () => {
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
    expect(sentry.captured).toHaveLength(1);
    expect(sentry.captured[0]).toMatchObject({ msg: 'commander.probe.login_bridge_failed', level: 'error' });
    expect(sentry.captured[0].tags).toMatchObject({ app: 'commander', probe: 'login-bridge' });
    expect(db.inserts[0].row).toMatchObject({ job_name: '/commander/internal/login-bridge-probe', status: 'error' });
    expect(db.inserts[0].row.error).toMatch(/grant - status=400/);
  });
});
