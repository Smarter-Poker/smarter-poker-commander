function notificationsEnabled(row, membership) {
  if (typeof membership?.notifications_enabled === 'boolean') {
    return membership.notifications_enabled;
  }
  return row?.notify_new_games !== false || row?.notify_announcements !== false;
}

function canRemoveMember({
  callerRole,
  callerUserId,
  memberId,
  ownerId,
  targetRole,
  targetUserId,
}) {
  if (!memberId || !callerRole) return false;
  if (targetUserId && targetUserId === callerUserId) return false;
  if (targetUserId && targetUserId === ownerId) return false;

  const normalizedCallerRole = String(callerRole).toLowerCase();
  const normalizedTargetRole = String(targetRole).toLowerCase();
  if (['owner', 'host'].includes(normalizedTargetRole)) return false;
  if (normalizedCallerRole === 'owner') return true;
  return normalizedCallerRole === 'admin' && normalizedTargetRole !== 'admin';
}

function canonicalMember(row, membership, context) {
  const relationship = row.relationship || 'member';
  const role = membership?.role || row.member_role || (
    relationship === 'follower' ? 'follower' : 'member'
  );
  const status = membership?.status || row.member_status || (
    relationship === 'follower' ? 'following' : null
  );
  const memberId = membership?.id || null;
  const targetUserId = membership?.user_id || row?.user_id || null;

  return {
    ...row,
    id: memberId,
    member_id: memberId,
    role,
    status,
    joined_at: membership?.joined_at || row.member_joined_at || null,
    last_attended_date: membership?.last_attended || null,
    notifications_enabled: notificationsEnabled(row, membership),
    games_attended: membership?.games_attended ?? row.checked_in_games ?? 0,
    is_roster_only: membership?.is_roster_only === true,
    can_remove: canRemoveMember({
      callerRole: context.callerRole,
      callerUserId: context.callerUserId,
      memberId,
      ownerId: context.ownerId,
      targetRole: role,
      targetUserId,
    }),
  };
}

export function normalizeHomeGroupRoster(
  rpcRows = [],
  memberships = [],
  { callerUserId = null, ownerId = null } = {}
) {
  const memberByUserId = new Map();
  const rosterOnly = [];

  for (const membership of memberships || []) {
    if (!membership?.id) continue;
    if (membership.user_id) memberByUserId.set(membership.user_id, membership);
    else if (membership.is_roster_only === true) rosterOnly.push(membership);
  }

  const callerMembership = callerUserId ? memberByUserId.get(callerUserId) : null;
  const callerRole = callerUserId === ownerId
    ? 'owner'
    : (
      callerMembership?.status === 'approved' && callerMembership?.role === 'admin'
        ? 'admin'
        : null
    );
  const context = { callerRole, callerUserId, ownerId };

  const normalized = (rpcRows || []).map((row) => (
    canonicalMember(row, memberByUserId.get(row?.user_id) || null, context)
  ));

  for (const membership of rosterOnly) {
    normalized.push(canonicalMember({
      user_id: null,
      username: null,
      display_name: membership.display_name || 'Roster player',
      avatar_url: null,
      relationship: 'member',
      member_role: membership.role,
      member_status: membership.status,
      member_joined_at: membership.joined_at,
      follower_since: null,
      notify_new_games: membership.notify_new_games,
      notify_announcements: membership.notify_announcements,
      checked_in_games: membership.games_attended || 0,
    }, membership, context));
  }

  return normalized;
}

export default normalizeHomeGroupRoster;
