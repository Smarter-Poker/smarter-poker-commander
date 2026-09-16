import test from 'node:test';
import assert from 'node:assert/strict';
import { reportApiError, withApiErrorHandler } from '../../vendor/commander-shared/src/lib/apiErrorHandler.js';

function response(headersSent = false) {
  return {
    headersSent, code: null, body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('API wrapper returns successful handler values without logging', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const req = { method: 'GET', url: '/api/example' };
  const res = response();
  const value = await withApiErrorHandler(async (r, s) => {
    assert.equal(r, req); assert.equal(s, res); return 'result';
  })(req, res);
  assert.equal(value, 'result');
  assert.equal(log.mock.callCount(), 0);
  assert.equal(res.code, null);
});

test('production exceptions keep generic 500 and local diagnostics without request secrets', async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => oldEnv === undefined ? delete process.env.NODE_ENV : process.env.NODE_ENV = oldEnv);
  const log = t.mock.method(console, 'error', () => {});
  const res = response();
  await withApiErrorHandler(async () => { throw new Error('database unavailable'); })({
    method: 'POST', url: '/api/example?token=private',
    body: { password: 'private' }, headers: { authorization: 'private' },
  }, res);
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { success: false, error: 'Internal server error' });
  assert.equal(log.mock.callCount(), 1);
  assert.deepEqual(log.mock.calls[0].arguments[1], {
    route: '/api/example', method: 'POST', name: 'Error', message: 'database unavailable',
  });
  assert.ok(!JSON.stringify(log.mock.calls[0].arguments).includes('private'));
});

test('handler exceptions do not send a second response after headers were sent', async (t) => {
  t.mock.method(console, 'error', () => {});
  const res = response(true);
  const value = await withApiErrorHandler(() => { throw new Error('late failure'); })({}, res);
  assert.equal(value, undefined); assert.equal(res.code, null); assert.equal(res.body, null);
});

test('logging failure cannot suppress the 500 response', async (t) => {
  t.mock.method(console, 'error', () => { throw new Error('broken console'); });
  const res = response();
  await withApiErrorHandler(() => { throw new Error('original failure'); })({}, res);
  assert.equal(res.code, 500); assert.equal(res.body.success, false);
});

test('non-error thrown objects are not serialized into logs', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const circular = { authorization: 'private' }; circular.self = circular;
  assert.doesNotThrow(() => reportApiError(circular, { url: '/api/test?q=private' }, { userId: 'private' }));
  assert.deepEqual(log.mock.calls[0].arguments[1], {
    route: '/api/test', method: 'unknown', name: 'Error', message: 'Unknown error',
  });
});
