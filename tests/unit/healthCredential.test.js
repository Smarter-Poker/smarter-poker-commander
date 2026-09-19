/**
 * /api/health tells the truth about the service-role key.
 *
 * The incident this pins (2026-09-18): Commander's Supabase key stopped being
 * registered for the project. Every poker_venues read failed with
 * `Unregistered API key`, /api/venues answered 500 for hours, and the venue
 * directory on smarter.poker served Googlebot nothing. This endpoint reported
 * `status: 'ok'` throughout, because `supabase_service_role` only ever meant
 * "the environment variable is a non-empty string" - which it was.
 *
 * CLAUDE.md law 3.2: the absence of reported issues is not proof of health.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const selectResult = { value: { error: null }, throws: null };

vi.mock('../../src/lib/supabaseServerClient', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        limit: () => ({
          abortSignal: async () => {
            if (selectResult.throws) throw selectResult.throws;
            return selectResult.value;
          },
        }),
      }),
    }),
  }),
}));

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

// The module caches its answer for 30s, so each case needs a fresh copy.
async function freshHandler() {
  vi.resetModules();
  return (await import('../../pages/api/health.js')).default;
}

const ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-key-shaped-string';
  selectResult.value = { error: null };
  selectResult.throws = null;
});

afterEach(() => {
  process.env = { ...ENV };
});

describe('/api/health service-role verification', () => {
  it('reports degraded when Supabase refuses the key, while presence stays true', async () => {
    selectResult.value = { error: { message: 'Unregistered API key' } };
    const res = mockRes();
    await (await freshHandler())({ method: 'GET' }, res);

    expect(res.body.status).toBe('degraded');
    // The old boolean is still true - which is exactly why it was never a check.
    expect(res.body.auth.supabase_service_role).toBe(true);
    expect(res.body.auth.supabase_service_role_valid).toBe(false);
    expect(res.body.auth.supabase_service_role_detail).toMatch(/Unregistered API key/);
  });

  it('stays HTTP 200 on a bad key so a deploy can still be verified mid-incident', async () => {
    selectResult.value = { error: { message: 'Unregistered API key' } };
    const res = mockRes();
    await (await freshHandler())({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.version).toBeTruthy();
  });

  it('reports ok when the key reads the project', async () => {
    const res = mockRes();
    await (await freshHandler())({ method: 'GET' }, res);
    expect(res.body.status).toBe('ok');
    expect(res.body.auth.supabase_service_role_valid).toBe(true);
    expect(res.body.auth.supabase_service_role_detail).toBeNull();
  });

  it('never puts the key, or any secret value, in the response', async () => {
    selectResult.value = { error: { message: 'Unregistered API key' } };
    const res = mockRes();
    await (await freshHandler())({ method: 'GET' }, res);
    expect(JSON.stringify(res.body)).not.toContain('a-key-shaped-string');
  });

  it('reports null, not false, when no key is configured at all', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = mockRes();
    await (await freshHandler())({ method: 'GET' }, res);
    expect(res.body.auth.supabase_service_role_valid).toBeNull();
    // A local build with no key is not an outage.
    expect(res.body.status).toBe('ok');
  });

  it('treats a thrown timeout as a refused credential, not a crash', async () => {
    selectResult.throws = new Error('The operation was aborted');
    const res = mockRes();
    await (await freshHandler())({ method: 'GET' }, res);
    expect(res.body.auth.supabase_service_role_valid).toBe(false);
    expect(res.statusCode).toBe(200);
  });
});

describe('the login-bridge probe asserts it', () => {
  it('checks that the key is accepted, not merely present', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../src/lib/probe/loginBridgeProbe.mjs', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/supabase_service_role_valid/);
    // false is the outage; null (no key at all) must not page.
    expect(src).toMatch(/supabase_service_role_valid\s*!==\s*false/);
  });
});
