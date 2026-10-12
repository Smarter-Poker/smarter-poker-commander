import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PLAYER_STATS_COLUMNS, QUALIFICATION_COLUMNS } from '../../src/lib/commander/rewardPointsRetirement';

const state = vi.hoisted(() => ({ type: 'cash_hours', writes: [], queries: [], orders: [], readError: false, staff: { id: 'staff', venue_id: 7 } }));
vi.mock('../../src/lib/commander/auth', () => ({
  guardStaff: async () => state.staff,
  guardWriteStaff: async () => state.staff,
  verifyStaffSession: async () => ({ staff: state.staff }),
  getUser: async () => ({ id: 'player' }),
}));
vi.mock('../../src/lib/apiRateLimit', () => ({ LIMITS: { write: {} }, applyRateLimit: () => true }));
vi.mock('../../src/lib/apiErrorHandler', () => ({ reportApiError: () => {} }));
vi.mock('../../src/lib/supabaseServerClient', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'staff' } }, error: null }) },
    from(table) {
      let payload; let projection;
      const result = () => ({ data: table === 'commander_freerolls'
        ? { id: 'freeroll', venue_id: 7, qualification_type: state.type, qualification_threshold: 20 }
        : table === 'commander_staff' ? { id: 'staff' } : payload || [], error: state.readError && projection === 'qualification_type, qualification_threshold' ? { message: 'Read Failed' } : null, count: 0 });
      const q = {
        select(columns) { projection = columns; state.queries.push({ table, columns }); return q; },
        eq() { return q; }, order(field) { state.orders.push({ table, field }); return q; }, range() { return q; },
        insert(value) { payload = value; state.writes.push({ table, payload: value }); return q; },
        upsert(value) { payload = value; state.writes.push({ table, payload: value }); return q; },
        maybeSingle: async () => result(),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return q;
    },
  }),
}));
import createHandler from '../../pages/api/freerolls/index';
import qualificationsHandler from '../../pages/api/freerolls/[id]/qualifications';
import analyticsHandler from '../../pages/api/analytics/players';

function response() {
  return { statusCode: 200, body: null, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {},
  };
}
const request = (body, method = 'POST') => ({ method, body, query: { id: 'freeroll', venue_id: '7' }, headers: { authorization: 'Bearer test' }, socket: { remoteAddress: '127.0.0.1' } });

beforeEach(() => { state.type = 'cash_hours'; state.writes = []; state.queries = []; state.orders = []; state.readError = false; });

describe('points never qualify players for Commander benefits', () => {
  it('refuses new points-qualified freerolls before a database write', async () => {
    const res = response();
    await createHandler(request({ name: 'Test', qualification_type: 'tournament_points' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('POINTS_REWARDS_RETIRED');
    expect(state.writes).toEqual([]);
  });

  it.each(['cash_hours', 'custom', 'open'])('preserves creation with %s qualification', async (type) => {
    const res = response();
    await createHandler(request({ name: 'Test', qualification_type: type }), res);
    expect(res.statusCode).toBe(201);
    expect(state.writes[0].payload.qualification_type).toBe(type);
  });

  it('cannot manually override a historical points qualification', async () => {
    state.type = 'tournament_points';
    const res = response();
    await qualificationsHandler(request({ player_name: 'Test', manually_added: true, is_qualified: true }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('POINTS_REWARDS_RETIRED');
    expect(state.writes).toEqual([]);
  });

  it.each(['cash_hours', 'custom', 'open'])('rejects point payloads even under %s', async (type) => {
    state.type = type;
    const res = response();
    await qualificationsHandler(request({ player_name: 'Test', points_earned: 500 }), res);
    expect(res.statusCode).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it('cannot qualify when the authoritative qualification configuration read fails', async () => {
    state.readError = true;
    const res = response();
    await qualificationsHandler(request({ player_name: 'Test', manually_added: true }), res);
    expect(res.statusCode).toBe(500);
    expect(state.writes).toEqual([]);
  });

  it('cash hours still qualify without overwriting archived point history', async () => {
    const res = response();
    await qualificationsHandler(request({ player_name: 'Test', hours_logged: 20, points_earned: 0 }), res);
    expect(res.statusCode).toBe(200);
    expect(state.writes[0].payload.is_qualified).toBe(true);
    expect(state.writes[0].payload).not.toHaveProperty('points_earned');
    expect(state.queries.filter(q => q.table === 'commander_freeroll_qualifications')[0].columns).toBe(QUALIFICATION_COLUMNS);
  });

  it('analytics ignores legacy loyalty sort and does not query archived point/tier columns', async () => {
    const req = request({}, 'GET'); req.query.sort_by = 'loyalty_points';
    const res = response();
    await analyticsHandler(req, res);
    expect(res.statusCode).toBe(200);
    const projection = state.queries.find(q => q.table === 'commander_player_stats').columns;
    expect(projection).toContain(PLAYER_STATS_COLUMNS);
    expect(projection).not.toMatch(/loyalty_points|loyalty_tier|\*/);
    expect(res.body).not.toHaveProperty('tier_breakdown');
    expect(state.orders).toContainEqual({ table: 'commander_player_stats', field: 'total_hours' });
  });

  it('freeroll UI has no point inputs while leaderboard scoring remains present', () => {
    const ui = readFileSync('pages/commander/leagues.js', 'utf8');
    expect(ui).not.toContain('points_earned');
    expect(ui).not.toContain("value: 'tournament_points'");
    expect(ui).toContain('qualificationRetired');
    expect(readFileSync('pages/api/tournaments/leaderboards.js', 'utf8')).toContain('commander_tournament_points');
    expect(readFileSync('pages/api/exports/index.js', 'utf8')).toContain('PLAYER_STATS_COLUMNS');
  });
});

