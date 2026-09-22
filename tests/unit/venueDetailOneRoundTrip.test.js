/**
 * A venue page answers in one round trip, not six.
 *
 * GET /api/venues/:id made six Supabase reads one after another. Only the
 * venue decides whether the rest are shown, and none needs another's result.
 * The World Hub server-renders /hub/commander/venues/[id] from this route
 * with a 4s budget, and on 2026-09-22 a crawl of the venue directory - fifty
 * links in a burst, as Googlebot reads it - got a 503 on ten of fifty.
 *
 * Each mocked read below takes 60ms. Six in sequence would take 360ms; the
 * handler must finish in well under two reads' worth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const DELAY = 60;
const state = { started: [], venue: { id: 3109, name: 'Grand Victoria Casino' }, venueError: null };

function query(table) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    maybeSingle: () => q,
    then(resolve, reject) {
      state.started.push({ table, at: Date.now() });
      const result = table === 'poker_venues'
        ? { data: state.venue, error: state.venueError }
        : { data: table === 'commander_venue_settings' ? null : [], error: null };
      return new Promise((r) => setTimeout(() => r(result), DELAY)).then(resolve, reject);
    },
  };
  return q;
}

vi.mock('../../src/lib/supabaseServerClient', () => ({
  createClient: () => ({ from: (table) => query(table) }),
}));
vi.mock('../../src/lib/commander/auth', () => ({ guardManager: vi.fn() }));
vi.mock('../../src/lib/apiRateLimit', () => ({ applyRateLimit: () => true, LIMITS: {} }));
vi.mock('../../src/lib/apiErrorHandler', () => ({ reportApiError: vi.fn() }));

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const { default: handler } = await import('../../pages/api/venues/[id].js');

beforeEach(() => {
  state.started = [];
  state.venue = { id: 3109, name: 'Grand Victoria Casino' };
  state.venueError = null;
});

describe('GET /api/venues/:id', () => {
  it('issues all six reads together', async () => {
    const res = mockRes();
    const t0 = Date.now();
    await handler({ method: 'GET', query: { id: '3109' }, headers: {} }, res);
    const elapsed = Date.now() - t0;

    expect(res.statusCode).toBe(200);
    expect(state.started.map((s) => s.table).sort()).toEqual([
      'commander_games', 'commander_promotions', 'commander_tournaments',
      'commander_venue_settings', 'commander_waitlist', 'poker_venues',
    ]);
    // Every read began before the first one could have finished.
    const spread = Math.max(...state.started.map((s) => s.at)) - Math.min(...state.started.map((s) => s.at));
    expect(spread).toBeLessThan(DELAY);
    expect(elapsed).toBeLessThan(DELAY * 3);
  });

  it('still returns the whole payload', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: { id: '3109' }, headers: {} }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.venue.name).toBe('Grand Victoria Casino');
    expect(res.body.data).toMatchObject({
      settings: null, currentGames: [], waitlists: [], todaysTournaments: [], activePromotions: [],
    });
  });

  it('keeps the 503-not-404 rule for a failed venue read', async () => {
    state.venueError = { message: 'Unregistered API key' };
    state.venue = null;
    const res = mockRes();
    await handler({ method: 'GET', query: { id: '3109' }, headers: {} }, res);
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('keeps 404 for a venue that is genuinely absent', async () => {
    state.venue = null;
    const res = mockRes();
    await handler({ method: 'GET', query: { id: '999999999' }, headers: {} }, res);
    expect(res.statusCode).toBe(404);
  });
});
