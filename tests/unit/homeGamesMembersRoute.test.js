import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  caller: { id: '11111111-1111-4111-8111-111111111111' },
  targetId: '22222222-2222-4222-8222-222222222222',
  groupId: '33333333-3333-4333-8333-333333333333',
  groupOwnerId: '11111111-1111-4111-8111-111111111111',
};

const rpc = vi.fn();
const getUserScopedClient = vi.fn(() => ({ rpc }));
const guardUser = vi.fn(async () => state.caller);

function queryFor(table) {
  let projection = '';
  const query = {
    select(value) { projection = value; return query; },
    eq() { return query; },
    order() { return query; },
    limit() { return query; },
    async maybeSingle() {
      if (table === 'commander_home_groups') {
        return {
          data: {
            id: state.groupId,
            owner_id: state.groupOwnerId,
            is_private: true,
            requires_approval: true,
            invite_code: 'INVITE88',
          },
          error: null,
        };
      }
      if (table === 'profiles') {
        return { data: { id: state.targetId }, error: null };
      }
      if (table === 'commander_home_members' && projection.trim() === 'role, status') {
        // Exercise the canonical owner_id fallback: no redundant owner row.
        return { data: null, error: null };
      }
      if (table === 'commander_home_members') {
        return {
          data: {
            id: '44444444-4444-4444-8444-444444444444',
            user_id: state.targetId,
            display_name: null,
            role: 'member',
            status: 'approved',
            can_host: false,
            joined_at: '2026-09-06T00:00:00.000Z',
            created_at: '2026-09-06T00:00:00.000Z',
            games_attended: 0,
            is_roster_only: false,
            profiles: {
              id: state.targetId,
              username: 'invited-player',
              display_name: 'Invited Player',
              avatar_url: null,
            },
          },
          error: null,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  return query;
}

const serviceClient = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: state.caller }, error: null })),
  },
  from: vi.fn((table) => queryFor(table)),
};

vi.mock('../../src/lib/supabaseServerClient', () => ({
  createClient: () => serviceClient,
}));
vi.mock('../../src/lib/commander/auth', () => ({ guardUser }));
vi.mock('../../src/lib/apiRateLimit', () => ({
  LIMITS: { read: {}, write: {} },
  applyRateLimit: () => true,
}));
vi.mock('../../src/lib/apiErrorHandler', () => ({ reportApiError: vi.fn() }));
vi.mock('../../src/lib/home-games/rpcBridge', () => ({ getUserScopedClient }));

function mockResponse() {
  const res = { statusCode: 200, body: null, headersSent: false };
  res.setHeader = vi.fn();
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}

let handler;
beforeEach(async () => {
  vi.clearAllMocks();
  state.groupOwnerId = state.caller.id;
  rpc.mockResolvedValue({ data: { success: true }, error: null });
  handler = (await import('../../pages/api/home-games/groups/[id]/members.js')).default;
});

describe('home-game member invitations', () => {
  it('invites through the caller-JWT-scoped audited RPC and returns the canonical member', async () => {
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer caller-jwt' },
      query: { id: state.groupId },
      body: { user_id: state.targetId },
    };
    const res = mockResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(getUserScopedClient).toHaveBeenCalledOnce();
    expect(getUserScopedClient).toHaveBeenCalledWith('caller-jwt');
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('manage_home_group_member', {
      p_group_id: state.groupId,
      p_member_user_id: state.targetId,
      p_action: 'invite',
      p_caller_user_id: state.caller.id,
    });
    expect(res.body).toMatchObject({
      success: true,
      member: {
        user_id: state.targetId,
        role: 'member',
        status: 'approved',
        display_name: 'Invited Player',
        username: 'invited-player',
        profiles: { display_name: 'Invited Player', username: 'invited-player' },
      },
      message: 'User invited successfully',
    });
    expect(res.body.member).not.toHaveProperty('invited_by');
  });

  it('supports the World group page no-body self-join and both response aliases', async () => {
    state.groupOwnerId = '66666666-6666-4666-8666-666666666666';
    rpc.mockResolvedValue({
      data: {
        success: true,
        status: 'pending',
        role: 'member',
        member_id: '55555555-5555-4555-8555-555555555555',
      },
      error: null,
    });
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer caller-jwt' },
      query: { id: state.groupId },
    };
    const res = mockResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(rpc).toHaveBeenCalledWith('join_home_group', {
      p_group_id: state.groupId,
      p_caller_user_id: state.caller.id,
      p_invite_code: null,
    });
    expect(res.body).toMatchObject({
      success: true,
      status: 'pending',
      member: { status: 'pending', role: 'member' },
      membership: { status: 'pending', role: 'member' },
    });
    expect(res.body.member).toEqual(res.body.membership);
  });

  it('rejects a malformed group id before reading service-role data', async () => {
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer caller-jwt' },
      query: { id: 'not-a-uuid' },
      body: { user_id: state.targetId },
    };
    const res = mockResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(serviceClient.from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a stable conflict when the audited invite detects an existing member', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'ALREADY_MEMBER' },
    });
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer caller-jwt' },
      query: { id: state.groupId },
      body: { user_id: state.targetId },
    };
    const res = mockResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      code: 'ALREADY_MEMBER',
      error: 'This player is already a member of the group',
    });
  });
});
