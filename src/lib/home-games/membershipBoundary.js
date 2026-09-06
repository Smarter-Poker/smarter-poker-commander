const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHomeGamesUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export function resolveGroupMembershipAccess({ ownerId, userId, membership }) {
  const isOwner = Boolean(ownerId && userId && ownerId === userId);
  const isApprovedMember = membership?.status === 'approved';
  const role = isOwner
    ? 'owner'
    : (isApprovedMember ? (membership?.role || 'member') : null);

  return {
    isMember: isOwner || isApprovedMember,
    isManager: role === 'owner' || role === 'admin',
    isOwner,
    role,
  };
}

export function parseMembershipDeleteIntent(body) {
  const memberId = typeof body?.member_id === 'string' ? body.member_id.trim() : '';
  const leaveRequested = body?.action === 'leave';
  if (memberId && leaveRequested) return null;
  if (memberId && isHomeGamesUuid(memberId)) return { kind: 'remove', memberId };
  if (memberId) return null;
  if (leaveRequested) return { kind: 'leave', memberId: null };
  return null;
}

export function rsvpMembershipTransition({
  targetUserId,
  groupOwnerId,
  eventHostId,
  membershipStatus,
}) {
  if (targetUserId && (targetUserId === groupOwnerId || targetUserId === eventHostId)) {
    return 'eligible';
  }
  if (membershipStatus === 'approved') return 'eligible';
  if (membershipStatus === 'pending') return 'approve';
  return 'ineligible';
}

export default parseMembershipDeleteIntent;
