import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  allowsDeclinedReRequest,
  determineGroupAccess,
  normalizeGroupUpdates,
  normalizeJoinResult,
  PUBLIC_GROUP_SELECT,
  toMemberDto,
  toPublicGroup,
} from '../../src/lib/home-games/publicGroupBoundary';
import {
  mapMembershipRpcError,
  respondToMembershipRpcError,
} from '../../src/lib/home-games/membershipRpcError';
import {
  isHomeGamesUuid,
  parseMembershipDeleteIntent,
  resolveGroupMembershipAccess,
  rsvpMembershipTransition,
} from '../../src/lib/home-games/membershipBoundary';
import { normalizeHomeGroupRoster } from '../../src/lib/home-games/rosterBoundary';
import {
  groupManagerRsvps,
  MANAGER_RSVP_SELECT,
  toManagerRsvpDto,
} from '../../src/lib/home-games/rsvpBoundary';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

describe('Commander Home Games public boundary', () => {
  it('emits only the explicit public DTO', () => {
    const dto = toPublicGroup({
      id: 'group-1',
      name: 'Friday Game',
      owner_id: 'host-1',
      club_code: 'SHARE1',
      is_private: true,
      requires_approval: true,
      city: 'Chicago',
      state: 'IL',
      default_game_type: 'plo',
      default_stakes: '$2/$5',
      member_count: 4,
      profiles: { id: 'host-1', display_name: 'Host', avatar_url: null },
      invite_code: 'SECRET88',
      latitude: 41.123,
      longitude: -87.456,
      zip_code: '60601',
      contact_phone: '555-0100',
      settings: { allow_declined_re_request: true },
      commander_home_members: [{ user_id: 'member-1' }],
    });

    expect(dto).toMatchObject({
      id: 'group-1',
      club_code: 'SHARE1',
      city: 'Chicago',
      state: 'IL',
      game_type: 'plo',
      stakes: '$2/$5',
      visibility: 'private',
    });
    for (const forbidden of [
      'invite_code',
      'latitude',
      'longitude',
      'zip_code',
      'contact_phone',
      'settings',
      'commander_home_members',
    ]) {
      expect(dto).not.toHaveProperty(forbidden);
    }
  });

  it('authorizes the resource before allowing member or private-field reads', () => {
    const group = { id: 'group-1', owner_id: 'host-1', is_private: true };

    expect(determineGroupAccess({ group, userId: null, membership: null })).toMatchObject({
      allowed: false,
      mayReadMembers: false,
      mayReadPrivilegedGroup: false,
    });
    expect(determineGroupAccess({
      group,
      userId: null,
      membership: null,
      viaInviteCode: true,
    })).toMatchObject({
      allowed: true,
      isPreview: true,
      mayReadMembers: false,
      mayReadPrivilegedGroup: false,
    });
    expect(determineGroupAccess({
      group,
      userId: 'member-1',
      membership: { status: 'banned', role: 'admin' },
    })).toMatchObject({
      allowed: false,
      isAdmin: false,
      mayReadMembers: false,
    });
    expect(determineGroupAccess({
      group,
      userId: 'host-1',
      membership: null,
    })).toMatchObject({
      allowed: true,
      isAdmin: true,
      mayReadMembers: true,
      mayReadPrivilegedGroup: true,
    });
  });

  it('never upgrades an unknown join result to approved', () => {
    expect(normalizeJoinResult({
      success: true,
      status: 'pending',
      member_id: 'membership-1',
      role: 'member',
    })).toEqual({
      status: 'pending',
      membership: { id: 'membership-1', status: 'pending', role: 'member' },
    });
    expect(normalizeJoinResult({ success: true })).toBeNull();
    expect(normalizeJoinResult({ success: true, status: 'banned' })).toBeNull();
  });

  it('normalizes both Commander self-join surfaces without an approved fallback', () => {
    for (const path of [
      'pages/api/home-games/join/[code].js',
      'pages/api/home-games/groups/[id]/members.js',
    ]) {
      const source = read(path);
      expect(source).toContain('normalizeJoinResult(result)');
      expect(source).toContain("case 'DECLINED':");
      expect(source).not.toMatch(/membership\?\.status\s*\|\|\s*['"]approved['"]/);
    }
  });

  it('requires an explicit boolean policy before a declined member can retry', () => {
    expect(allowsDeclinedReRequest(undefined)).toBe(false);
    expect(allowsDeclinedReRequest({ allow_declined_re_request: 'true' })).toBe(false);
    expect(allowsDeclinedReRequest({ allow_declined_re_request: true })).toBe(true);
  });

  it('keeps legacy group settings wired to canonical database columns', () => {
    expect(normalizeGroupUpdates({
      stakes: '$5/$10',
      game_type: 'plo',
      visibility: 'public',
      contact_phone: '555-0100',
      website_url: 'https://example.com',
      quality_score: 100,
    }, '2026-09-06T00:00:00.000Z')).toEqual({
      updates: {
        updated_at: '2026-09-06T00:00:00.000Z',
        contact_phone: '555-0100',
        website_url: 'https://example.com',
        default_game_type: 'plo',
        default_stakes: '$5/$10',
        is_private: false,
      },
      error: null,
    });
    expect(normalizeGroupUpdates({ visibility: 'friends' })).toEqual({
      updates: null,
      error: 'Visibility must be private or public',
    });

    const source = read('pages/api/home-games/groups/[id].js');
    expect(source).toContain('normalizeGroupUpdates(req.body)');
    expect(source).toContain('toStaffGroup(updated)');
  });

  it('keeps both public group handlers off star projections', () => {
    expect(PUBLIC_GROUP_SELECT).not.toMatch(/(^|,)\s*\*/m);
    for (const path of [
      'pages/api/home-games/groups/index.js',
      'pages/api/home-games/groups/[id].js',
    ]) {
      const source = read(path);
      expect(source).not.toMatch(/\.select\(\s*`[\s\S]*?\*[\s\S]*?`\s*\)/);
      expect(source).toContain('PUBLIC_GROUP_SELECT');
      expect(source).toContain('toPublicGroup');
    }
  });

  it('returns a bounded member DTO from the dedicated member endpoint', () => {
    expect(toMemberDto({
      id: 'membership-1',
      user_id: null,
      display_name: 'Walk-in Player',
      role: 'member',
      status: 'approved',
      can_host: false,
      joined_at: '2026-09-06T00:00:00.000Z',
      created_at: '2026-09-05T00:00:00.000Z',
      games_attended: 2,
      is_roster_only: true,
      notifications_enabled: true,
      invited_by: 'private-audit-field',
    })).toEqual({
      id: 'membership-1',
      user_id: null,
      display_name: 'Walk-in Player',
      username: null,
      avatar_url: null,
      role: 'member',
      status: 'approved',
      can_host: false,
      joined_at: '2026-09-06T00:00:00.000Z',
      created_at: '2026-09-05T00:00:00.000Z',
      games_attended: 2,
      is_roster_only: true,
      profiles: {
        id: null,
        username: null,
        display_name: 'Walk-in Player',
        avatar_url: null,
      },
    });

    const source = read('pages/api/home-games/groups/[id]/members.js');
    expect(source).toContain('.select(MEMBER_SELECT)');
    expect(source).toContain('.map(toMemberDto)');
    expect(source).toContain('LIMITS.read');
  });

  it('authenticates a per-RSVP read before service-role resource access', () => {
    const source = read('pages/api/home-games/rsvps/[id].js');
    const identityGate = source.indexOf('const caller = await guardUser(req, res)');
    const resourceRead = source.indexOf(".from('commander_home_rsvps')");

    expect(identityGate).toBeGreaterThan(0);
    expect(resourceRead).toBeGreaterThan(identityGate);
    expect(source).toContain('LIMITS.read');
  });

  it('routes invitations, status, role, leave, and removal through audited RPCs', () => {
    const source = read('pages/api/home-games/groups/[id]/members.js');
    expect(source).toMatch(/\.rpc\(\s*['"]manage_home_group_member['"]/);
    expect(source).toMatch(/\.rpc\(\s*['"]leave_home_group['"]/);
    expect(source).toContain("p_action: 'remove'");
    expect(source).toContain("p_action: 'invite'");
    expect(source).toContain("rpcAction = 'ban'");
    expect(source).toContain("rpcAction = 'decline'");
    expect(source).toContain("rpcAction = req.body.can_host ? 'grant_host' : 'revoke_host'");
    expect(source).toContain('p_member_user_id: targetMember.user_id || targetMember.id');
    expect(source).not.toMatch(
      /\.from\(['"]commander_home_members['"]\)\s*\.delete\(\)/
    );
    expect(source).not.toMatch(
      /\.from\(['"]commander_home_members['"]\)\s*\.update\(/
    );
    expect(source).not.toMatch(
      /\.from\(['"]commander_home_members['"]\)\s*\.insert\(/
    );
  });

  it('maps expected membership lifecycle conflicts without returning a generic 500', () => {
    expect(mapMembershipRpcError({ code: 'P0001', message: 'TARGET_NOT_PENDING' })).toEqual({
      status: 409,
      code: 'TARGET_NOT_PENDING',
      error: 'This membership request is no longer pending',
    });
    expect(mapMembershipRpcError({ code: 'P0001', message: 'ADMIN_CANNOT_MODIFY_PEER' }))
      .toMatchObject({ status: 403, code: 'ADMIN_CANNOT_MODIFY_PEER' });
    expect(mapMembershipRpcError({ code: '23505', message: 'duplicate key value' }))
      .toMatchObject({ status: 409, code: 'MEMBERSHIP_CONFLICT' });
    expect(mapMembershipRpcError({ code: '23505', message: 'ALREADY_MEMBER' }))
      .toMatchObject({ status: 409, code: 'ALREADY_MEMBER' });
    expect(mapMembershipRpcError({ code: '42501', message: 'RSVP_MEMBERSHIP_REQUIRED' }))
      .toMatchObject({ status: 403, code: 'RSVP_MEMBERSHIP_REQUIRED' });
    expect(mapMembershipRpcError({ code: '42501', message: 'RSVP_MEMBERSHIP_BANNED' }))
      .toMatchObject({ status: 403, code: 'RSVP_MEMBERSHIP_BANNED' });
    expect(mapMembershipRpcError({ code: 'P0001', message: 'MEMBERSHIP_CONFLICT' }))
      .toMatchObject({ status: 409, code: 'MEMBERSHIP_CONFLICT' });
    expect(mapMembershipRpcError({ code: 'XX000', message: 'unexpected database detail' }))
      .toBeNull();

    for (const path of [
      'pages/api/home-games/join/[code].js',
      'pages/api/home-games/groups/[id]/members.js',
    ]) {
      expect(read(path)).toContain('respondToMembershipRpcError');
    }
  });

  it('terminates mapped error handling even when Next res.json returns undefined', () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => undefined);

    expect(respondToMembershipRpcError(
      res,
      { code: 'P0001', message: 'TARGET_NOT_PENDING' }
    )).toBe(true);
    expect(res.status).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledOnce();
  });

  it('requires an explicit self-leave intent when no target member id is present', () => {
    const memberId = '11111111-1111-4111-8111-111111111111';
    expect(parseMembershipDeleteIntent({})).toBeNull();
    expect(parseMembershipDeleteIntent({ member_id: undefined })).toBeNull();
    expect(parseMembershipDeleteIntent({ action: 'leave' })).toEqual({
      kind: 'leave',
      memberId: null,
    });
    expect(parseMembershipDeleteIntent({ member_id: ` ${memberId} ` })).toEqual({
      kind: 'remove',
      memberId,
    });
    expect(parseMembershipDeleteIntent({ member_id: 'not-a-uuid' })).toBeNull();
    expect(parseMembershipDeleteIntent({ member_id: memberId, action: 'leave' })).toBeNull();

    const source = read('pages/api/home-games/groups/[id]/members.js');
    expect(source).toContain('MEMBERSHIP_DELETE_TARGET_REQUIRED');
    expect(source).toContain("intent.kind === 'leave'");
  });

  it('uses canonical group ownership when the redundant membership row is missing', () => {
    expect(resolveGroupMembershipAccess({
      ownerId: 'owner-1',
      userId: 'owner-1',
      membership: null,
    })).toEqual({
      isMember: true,
      isManager: true,
      isOwner: true,
      role: 'owner',
    });
    expect(resolveGroupMembershipAccess({
      ownerId: 'owner-1',
      userId: 'admin-1',
      membership: { role: 'admin', status: 'approved' },
    })).toMatchObject({ isMember: true, isManager: true, isOwner: false, role: 'admin' });
    expect(resolveGroupMembershipAccess({
      ownerId: 'owner-1',
      userId: 'pending-1',
      membership: { role: 'admin', status: 'pending' },
    })).toMatchObject({ isMember: false, isManager: false, isOwner: false, role: null });

    expect(isHomeGamesUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isHomeGamesUuid('not-a-uuid')).toBe(false);

    const source = read('pages/api/home-games/groups/[id]/members.js');
    expect(source).toContain('resolveGroupMembershipAccess');
    expect(source).toContain('ownerId: groupResult.data.owner_id');
    expect(source).toContain('isHomeGamesUuid(groupId)');
    expect(source).toContain('isHomeGamesUuid(user_id)');
  });

  it('normalizes roster member ids and fields and preserves roster-only players', () => {
    const roster = normalizeHomeGroupRoster([
      {
        user_id: 'owner-1',
        display_name: 'Owner',
        relationship: 'member',
        member_role: 'owner',
        member_status: 'approved',
        notify_new_games: true,
        notify_announcements: true,
      },
      {
        user_id: 'follower-1',
        display_name: 'Follower',
        relationship: 'follower',
        member_role: null,
        member_status: null,
        notify_new_games: false,
        notify_announcements: true,
      },
    ], [
      {
        id: 'membership-owner',
        user_id: 'owner-1',
        role: 'owner',
        status: 'approved',
        notifications_enabled: true,
        games_attended: 4,
        is_roster_only: false,
      },
      {
        id: 'membership-roster',
        user_id: null,
        display_name: 'Walk-in Player',
        role: 'member',
        status: 'approved',
        notifications_enabled: false,
        games_attended: 2,
        is_roster_only: true,
      },
    ], {
      callerUserId: 'owner-1',
      ownerId: 'owner-1',
    });

    expect(roster).toHaveLength(3);
    expect(roster[0]).toMatchObject({
      id: 'membership-owner',
      member_id: 'membership-owner',
      role: 'owner',
      status: 'approved',
      can_remove: false,
    });
    expect(roster[1]).toMatchObject({
      id: null,
      member_id: null,
      role: 'follower',
      status: 'following',
      can_remove: false,
    });
    expect(roster[2]).toMatchObject({
      id: 'membership-roster',
      member_id: 'membership-roster',
      display_name: 'Walk-in Player',
      is_roster_only: true,
      can_remove: true,
    });

    const source = read('pages/api/home-games/groups/[id]/roster.js');
    expect(source).toContain('normalizeHomeGroupRoster');
    expect(source).toContain('is_roster_only');
  });

  it('only exposes roster removals the audited RPC will authorize', () => {
    const rpcRows = [
      { user_id: 'admin-self', relationship: 'member', member_role: 'admin', member_status: 'approved' },
      { user_id: 'admin-peer', relationship: 'member', member_role: 'admin', member_status: 'approved' },
      { user_id: 'ordinary-member', relationship: 'member', member_role: 'member', member_status: 'approved' },
      { user_id: 'owner-user', relationship: 'member', member_role: 'member', member_status: 'approved' },
    ];
    const memberships = [
      { id: 'self-id', user_id: 'admin-self', role: 'admin', status: 'approved' },
      { id: 'peer-id', user_id: 'admin-peer', role: 'admin', status: 'approved' },
      { id: 'member-id', user_id: 'ordinary-member', role: 'member', status: 'approved' },
      { id: 'owner-id', user_id: 'owner-user', role: 'member', status: 'approved' },
    ];

    const roster = normalizeHomeGroupRoster(rpcRows, memberships, {
      callerUserId: 'admin-self',
      ownerId: 'owner-user',
    });
    expect(roster.map((row) => [row.user_id, row.can_remove])).toEqual([
      ['admin-self', false],
      ['admin-peer', false],
      ['ordinary-member', true],
      ['owner-user', false],
    ]);
  });

  it('promotes a pending member through the audited RPC before approving an RSVP', () => {
    expect(rsvpMembershipTransition({
      targetUserId: 'member-1',
      groupOwnerId: 'owner-1',
      eventHostId: 'host-1',
      membershipStatus: 'pending',
    })).toBe('approve');
    expect(rsvpMembershipTransition({
      targetUserId: 'member-1',
      groupOwnerId: 'owner-1',
      eventHostId: 'host-1',
      membershipStatus: 'banned',
    })).toBe('ineligible');
    expect(rsvpMembershipTransition({
      targetUserId: 'host-1',
      groupOwnerId: 'owner-1',
      eventHostId: 'host-1',
      membershipStatus: null,
    })).toBe('eligible');

    const source = read('pages/api/home-games/rsvps/[id].js');
    expect(source).toContain("action === 'approve' || action === 'waitlist'");
    expect(source).toContain("approvePending: action === 'approve'");
    const auditedApproval = source.indexOf("p_action: 'approve'");
    const rsvpWrite = source.indexOf('.update(patch)');
    expect(auditedApproval).toBeGreaterThan(0);
    expect(rsvpWrite).toBeGreaterThan(auditedApproval);
    expect(source).not.toMatch(
      /\.from\(['"]commander_home_members['"]\)[\s\S]{0,200}\.update\(\{\s*status:\s*['"]approved['"]/m
    );
  });

  it('returns the flat RSVP contract consumed by World while preserving grouped counts', () => {
    expect(MANAGER_RSVP_SELECT).not.toContain('*');
    const normalized = toManagerRsvpDto({
      id: 'rsvp-1',
      game_id: 'game-1',
      user_id: 'player-1',
      response: 'waitlist',
      is_confirmed: false,
      bringing_guests: 2,
      guest_names: ['A', 'B'],
      seat_number: 4,
      profiles: {
        id: 'player-1',
        username: 'player',
        display_name: 'Player One',
        avatar_url: '/avatar.png',
      },
    });

    expect(normalized).toMatchObject({
      response: 'waitlist',
      status: 'waitlist',
      bringing_guests: 2,
      guest_count: 2,
      seat_number: 4,
      seat_assignment: 4,
      player_name: 'Player One',
      profiles: { username: 'player' },
    });
    expect(groupManagerRsvps([normalized])).toEqual({
      yes: [],
      maybe: [],
      no: [],
      waitlist: [normalized],
      pending: [],
    });

    const pendingApproval = toManagerRsvpDto({
      id: 'rsvp-2',
      response: 'yes',
      is_confirmed: false,
    });
    const confirmed = toManagerRsvpDto({
      id: 'rsvp-3',
      response: 'yes',
      is_confirmed: true,
    });
    expect(pendingApproval).toMatchObject({ response: 'yes', status: 'pending' });
    expect(confirmed).toMatchObject({ response: 'yes', status: 'yes' });

    const source = read('pages/api/home-games/events/[id]/rsvp.js');
    expect(source).toContain('rsvps: normalizedRsvps');
    expect(source).toContain('grouped,');
    expect(source).toContain('Only the event host or group managers can view RSVPs');
    expect(source).toContain('normalizedRsvp.response === \'waitlist\'');
    expect(source).not.toContain('event.rsvp_yes + spotsNeeded');
  });

  it('only sends approval notifications when the capacity trigger actually confirms the RSVP', () => {
    const source = read('pages/api/home-games/rsvps/[id].js');
    expect(source).toContain("updated.response === 'yes'");
    expect(source).toContain('updated.is_confirmed === true');
    expect(source).toContain('if (approvalStateChanged)');
    expect(source).toContain('state_changed: approvalStateChanged');
  });
});
