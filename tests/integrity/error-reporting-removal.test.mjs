import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.REMOVAL_CHECK_ROOT || fileURLToPath(new URL('../..', import.meta.url)));
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = resolve(dir, e.name);
    return e.isDirectory() ? walk(path) : [path];
  });
}

test('maintained app source and manifests cannot restore the retired SDK, transport or configuration', () => {
  const files = ['src', 'pages', 'vendor/commander-shared/src'].flatMap(dir => walk(resolve(root, dir)));
  for (const name of ['package.json', 'package-lock.json', 'next.config.js', '.env.example', 'instrumentation.js', 'sentry.client.config.js', 'sentry.server.config.js', 'sentry.edge.config.js']) {
    const file = resolve(root, name);
    if (existsSync(file)) files.push(file);
  }
  const violations = files.filter(file => /\.(?:js|jsx|mjs|ts|tsx|json)$/.test(file) || file.endsWith('.env.example'))
    .filter(file => /@sentry(?:\/|-)|\bSENTRY_[A-Z_]+|NEXT_PUBLIC_SENTRY|sentry\.io|\bSentry\.|sentryWrap|withSentryRoute/i.test(readFileSync(file, 'utf8')));
  assert.deepEqual(violations.map(file => relative(root, file)), []);
});

test('local auth monitoring remains observable and cleans up listeners', async (t) => {
  const source = readFileSync(resolve(root, 'src/lib/authFlowMonitor.js'), 'utf8');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const listeners = new Map();
  const previous = globalThis.window;
  globalThis.window = {
    location: { pathname: '/commander/login' },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); },
  };
  t.after(() => previous === undefined ? delete globalThis.window : globalThis.window = previous);
  const error = t.mock.method(console, 'error', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  const cleanup = module.installAuthFlowMonitor();
  assert.deepEqual([...listeners.keys()], ['commander:unauthorized', 'error', 'unhandledrejection']);
  listeners.get('commander:unauthorized')({ detail: { url: '/api?token=private' } });
  listeners.get('error')({ error: new ReferenceError('missing function') });
  module.reportLoginFailure('login', new Error('login failed'), { password: 'private' });
  assert.equal(warn.mock.callCount(), 1); assert.equal(error.mock.callCount(), 2);
  assert.ok(!JSON.stringify([...warn.mock.calls, ...error.mock.calls].map(c => c.arguments)).includes('private'));
  cleanup(); assert.equal(listeners.size, 0);
});

test('structural login probe has no monitoring-service egress', async (t) => {
  const { runLoginBridgeProbe } = await import('../../src/lib/probe/loginBridgeProbe.mjs');
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const u = new URL(url); urls.push(u);
    assert.ok(['commander.example', 'hub.example'].includes(u.hostname));
    if (u.pathname.includes('/_next/')) {
      return new Response('bridge=1 check-subscription https://abcdef@o123.ingest.us.sentry.io/123', {
        status: 200, headers: { 'content-type': 'application/javascript' },
      });
    }
    if (u.pathname.endsWith('/commander/login')) {
      return new Response('<html><script src="https://commander.example/_next/static/chunks/pages/commander/login-123.js"></script></html>', { status: 200 });
    }
    if (u.pathname === '/api/health') {
      return Response.json({ auth: { staff_session_secret: true, supabase_service_role: true, dedicated_staff_session_secret: true } });
    }
    return new Response('{}', { status: u.pathname === '/auth/sso' ? 200 : 401 });
  });
  const report = await runLoginBridgeProbe({ commander: 'https://commander.example', hub: 'https://hub.example', log: () => {} });
  assert.ok(urls.length > 5);
  assert.ok(report.results.some(row => row.name.includes('signing secret')));
  assert.ok(report.results.some(row => row.name.includes('UNSIGNED staff session')));
});
