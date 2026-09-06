const RESPONSES = {
  UNAUTHORIZED: [401, 'Your session is not authorized for this membership change'],
  INVALID_ACTION: [400, 'That membership action is not supported'],
  MISSING_PARAMS: [400, 'Required membership details are missing'],
  INVITE_CODE_REQUIRED: [400, 'An invite or share code is required'],
  CANNOT_SELF_MANAGE: [403, 'Use the leave-group action to change your own membership'],
  NOT_A_HOST: [403, 'Only the owner or an approved admin can manage members'],
  CANNOT_MODIFY_OWNER: [403, 'The group owner cannot be modified here'],
  ADMIN_CANNOT_MODIFY_PEER: [403, 'Admins cannot modify another admin or the owner'],
  OWNER_ONLY_ACTION: [403, 'Only the group owner can change admin roles'],
  GROUP_NOT_FOUND: [404, 'Group not found'],
  MEMBER_NOT_FOUND: [404, 'Member not found'],
  GROUP_INACTIVE: [409, 'This group is not accepting membership changes'],
  ALREADY_OWNER: [409, 'You already own this group'],
  ALREADY_MEMBER: [409, 'This player is already a member of the group'],
  MEMBERSHIP_CONFLICT: [409, 'Membership changed during this request. Refresh and try again.'],
  MEMBERSHIP_STATE_INVALID: [409, 'This membership is in an unsupported state'],
  MEMBER_IS_ACTIVE_GAME_HOST: [409, "Reassign or cancel this member's active games before removing them"],
  TARGET_NOT_PENDING: [409, 'This membership request is no longer pending'],
  TARGET_NOT_BANNED: [409, 'This member is no longer banned'],
  TARGET_NOT_APPROVED: [409, 'Only an approved member can become an admin'],
  ALREADY_ADMIN: [409, 'This member is already an admin'],
  TARGET_NOT_ADMIN: [409, 'This member is not currently an admin'],
  OWNER_CANNOT_LEAVE: [409, 'Transfer ownership before leaving the group'],
  BANNED_CANNOT_LEAVE: [409, 'A banned membership must be resolved by the group owner'],
  RSVP_MEMBERSHIP_REQUIRED: [403, 'An eligible group membership is required for this RSVP'],
  RSVP_MEMBERSHIP_BANNED: [403, 'A banned member cannot hold an active RSVP'],
  RSVP_MEMBERSHIP_DECLINED: [403, 'A declined member cannot hold an active RSVP'],
  RSVP_MEMBERSHIP_INVALID: [409, 'This membership cannot hold an active RSVP'],
  RSVP_MEMBER_INELIGIBLE: [409, 'This membership is not eligible for an active RSVP'],
  RSVP_GAME_NOT_FOUND: [404, 'The game for this RSVP no longer exists'],
};

export function mapMembershipRpcError(error) {
  const code = String(error?.message || error?.details || '')
    .trim()
    .split(/\s+/)[0];

  if (error?.code === '23505') {
    if (code === 'ALREADY_MEMBER') {
      return { status: 409, code, error: RESPONSES.ALREADY_MEMBER[1] };
    }
    return {
      status: 409,
      code: 'MEMBERSHIP_CONFLICT',
      error: 'Membership changed during this request. Refresh and try again.',
    };
  }

  const response = RESPONSES[code];
  if (!response) return null;
  return { status: response[0], code, error: response[1] };
}

export function respondToMembershipRpcError(res, error, { includeSuccess = true } = {}) {
  const mapped = mapMembershipRpcError(error);
  if (!mapped) return false;

  res.status(mapped.status).json({
    ...(includeSuccess ? { success: false } : {}),
    code: mapped.code,
    error: mapped.error,
  });
  return true;
}

export default mapMembershipRpcError;
