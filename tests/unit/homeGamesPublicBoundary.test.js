import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  allowsDeclinedReRequest,
  determineGroupAccess,
  normalizeJoinResult,
  PUBLIC_GROUP_SELECT,
  toPublicGroup,
} from '../../src/lib/home-games/publicGroupBoundary';

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

  it('authenticates a per-RSVP read before service-role resource access', () => {
    const source = read('pages/api/home-games/rsvps/[id].js');
    const identityGate = source.indexOf('const caller = await guardUser(req, res)');
    const resourceRead = source.indexOf(".from('commander_home_rsvps')");

    expect(identityGate).toBeGreaterThan(0);
    expect(resourceRead).toBeGreaterThan(identityGate);
    expect(source).toContain('LIMITS.read');
  });
});
