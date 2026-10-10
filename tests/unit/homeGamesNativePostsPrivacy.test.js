import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ membership: 'approved', active: true, fail: false, reads: [], writes: [] }));
const rows = [
  { id: 'visible', group_id: '11111111-1111-4111-8111-111111111111', is_published: true, is_hidden: false, visible_to: 'members' },
  { id: 'legacy', group_id: '11111111-1111-4111-8111-111111111111', is_published: true, is_hidden: null, visible_to: 'members' },
  { id: 'hidden', group_id: '11111111-1111-4111-8111-111111111111', is_published: true, is_hidden: true, visible_to: 'members' },
  { id: 'draft', group_id: '11111111-1111-4111-8111-111111111111', is_published: false, is_hidden: false, visible_to: 'public' },
  { id: 'foreign', group_id: 'foreign', is_published: true, is_hidden: false, visible_to: 'public' },
];

function client(caller) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'viewer' } }, error: null }) },
    from(table) {
      state.reads.push({ table, caller });
      const filters = [];
      let inserted;
      const q = {
        select() { return q; }, eq(k, v) { filters.push(row => row[k] === v); return q; },
        or(value) { expect(value).toBe('is_hidden.is.null,is_hidden.eq.false'); filters.push(row => row.is_hidden !== true); return q; },
        order() { return q; }, range(start, end) { expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeGreaterThanOrEqual(start); return q; },
        insert(value) { inserted = value; state.writes.push(value); return q; },
        async maybeSingle() {
          if (table === 'commander_home_members') return { data: state.membership === 'approved' ? { role: 'member', status: state.membership } : null, error: null };
          if (table === 'commander_home_groups') return { data: { is_active: state.active }, error: state.fail ? { message: 'Unavailable' } : null };
          return { data: inserted ? { id: 'created', ...inserted } : null, error: null };
        },
        then(resolve, reject) {
          const data = rows.filter(row => filters.every(fn => fn(row)));
          return Promise.resolve({ data, error: state.fail ? { message: 'Unavailable' } : null, count: data.length }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

vi.mock('../../src/lib/supabaseServerClient', () => ({ createClient: () => client(false) }));
vi.mock('../../src/lib/home-games/rpcBridge', () => ({ getUserScopedClient: vi.fn(token => { expect(token).toBe('fixture-token'); return client(true); }) }));
vi.mock('../../src/lib/commander/auth', () => ({ guardUser: async () => ({ id: 'viewer' }) }));
vi.mock('../../src/lib/apiRateLimit', () => ({ applyRateLimit: () => true, LIMITS: {} }));
vi.mock('../../src/lib/apiErrorHandler', () => ({ reportApiError: vi.fn() }));

import handler from '../../pages/api/home-games/[id]/posts.js';

async function run({ method = 'GET', auth = true, limit = 20, body = {} } = {}) {
  const res = { statusCode: 200, body: null, headers: {}, headersSent: false,
    setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, headers: auth ? { authorization: 'Bearer fixture-token' } : {}, query: { id: rows[0].group_id, limit }, body }, res);
  return res;
}

beforeEach(() => { Object.assign(state, { membership: 'approved', active: true, fail: false, reads: [], writes: [] }); });

describe('canonical native Home Game posts privacy', () => {
  it('withholds hidden/draft/foreign posts while preserving visible legacy NULL and member-only posts through caller RLS', async () => {
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.posts.map(post => post.id)).toEqual(['visible', 'legacy']);
    expect(state.reads.find(read => read.table === 'commander_home_posts').caller).toBe(true);
    expect(res.headers['Cache-Control']).toContain('no-store');
  });
  it('bounds a negative page size rather than constructing a reversed range', async () => {
    const res = await run({ limit: -5 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.limit).toBe(1);
  });
  it('preserves authenticated approved-only access and denies inactive/unavailable groups before content read', async () => {
    expect((await run({ auth: false })).statusCode).toBe(401);
    for (const membership of ['pending', 'banned', null]) {
      state.membership = membership;
      expect((await run()).statusCode).toBe(403);
    }
    state.membership = 'approved'; state.active = false;
    expect((await run()).statusCode).toBe(403);
    state.active = true; state.fail = true;
    expect((await run()).statusCode).toBe(500);
    expect(state.reads.some(read => read.table === 'commander_home_posts')).toBe(false);
  });
  it('preserves existing canonical creation fields, caller identity and response shape', async () => {
    const res = await run({ method: 'POST', body: { content: 'Member update', post_type: 'update', visible_to: 'members' } });
    expect(res.statusCode).toBe(201);
    expect(state.writes).toEqual([{ group_id: rows[0].group_id, author_id: 'viewer', content: 'Member update', post_type: 'update', visible_to: 'members', image_urls: [], video_url: null, is_pinned: false, is_published: true }]);
    expect(res.body.data.post.id).toBe('created');
  });
});
