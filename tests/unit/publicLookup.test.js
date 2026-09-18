/**
 * A broken backend is not a missing venue.
 *
 * The incident this pins (2026-09-18): Commander's Supabase key stopped being
 * registered for the project, so every poker_venues read returned an error.
 * `pages/api/venues/[id].js` read `if (venueError || !venue) return 404`, so
 * for the length of the outage the API told every caller - including Googlebot,
 * by way of the World Hub's server-rendered /hub/commander/venues/[id] - that
 * real poker rooms did not exist. A 404 is a request to be forgotten. The
 * lookup was broken; the venues were always there.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  LOOKUP_RETRY_AFTER_SECONDS,
  lookupOutcome,
  sendLookupFailure,
} from '../../src/lib/commander/publicLookup';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = vi.fn((k, v) => { res.headers[k.toLowerCase()] = v; });
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

describe('lookupOutcome', () => {
  it('calls a failed read unavailable, not missing', () => {
    // The exact error Supabase returned throughout the 2026-09-18 outage.
    const outcome = lookupOutcome({
      error: { message: 'Unregistered API key', hint: 'Double check the provided API key' },
      record: null,
      noun: 'Venue',
    });
    expect(outcome.kind).toBe('unavailable');
    expect(outcome.status).toBe(503);
    expect(outcome.retryAfter).toBe(LOOKUP_RETRY_AFTER_SECONDS);
    expect(outcome.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('still says 404 when the read worked and the row is not there', () => {
    const outcome = lookupOutcome({ error: null, record: null, noun: 'Venue' });
    expect(outcome.kind).toBe('missing');
    expect(outcome.status).toBe(404);
    expect(outcome.body.error.code).toBe('NOT_FOUND');
    expect(outcome.retryAfter).toBeNull();
  });

  it('reports ok for a row that was found, and sends nothing', () => {
    const outcome = lookupOutcome({ error: null, record: { id: 3109 }, noun: 'Venue' });
    expect(outcome.kind).toBe('ok');
    expect(outcome.body).toBeNull();
    expect(sendLookupFailure(mockRes(), outcome)).toBe(false);
  });

  // An error WITH a row is still an error: PostgREST can hand back partial
  // data, and a read we do not trust must not be published as the truth.
  it('prefers the error when both an error and a record arrive', () => {
    expect(lookupOutcome({ error: { message: 'boom' }, record: { id: 1 } }).status).toBe(503);
  });

  it('names the thing in the 404 message', () => {
    expect(lookupOutcome({ record: null, noun: 'Venue' }).body.error.message).toMatch(/Venue/);
  });
});

describe('sendLookupFailure', () => {
  it('sends 503 with Retry-After and refuses to let it be cached', () => {
    const res = mockRes();
    const sent = sendLookupFailure(res, lookupOutcome({ error: { message: 'boom' }, noun: 'Venue' }));
    expect(sent).toBe(true);
    expect(res.statusCode).toBe(503);
    // A cached 503 outlives the incident it describes.
    expect(res.headers['retry-after']).toBe(String(LOOKUP_RETRY_AFTER_SECONDS));
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sends a bare 404 with no Retry-After', () => {
    const res = mockRes();
    expect(sendLookupFailure(res, lookupOutcome({ record: null, noun: 'Venue' }))).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(res.headers['retry-after']).toBeUndefined();
  });
});

describe('the public venue route uses it', () => {
  const route = read('pages/api/venues/[id].js');

  it('imports the helper and calls it on the venue read', () => {
    expect(route).toMatch(/from\s+['"]\.\.\/\.\.\/\.\.\/src\/lib\/commander\/publicLookup['"]/);
    expect(route).toMatch(/lookupOutcome\s*\(/);
    expect(route).toMatch(/sendLookupFailure\s*\(\s*res\s*,/);
  });

  // The regression itself: any `<something>Error || !<something>` guard that
  // answers 404 has collapsed the two answers back together.
  it('no longer answers a failed venue read with 404', () => {
    expect(route).not.toMatch(/venueError\s*\|\|\s*!venue/);
  });
});
