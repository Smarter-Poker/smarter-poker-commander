const RESPONSES = {
  UNAUTHORIZED: [401, 'Your Session Is Not Authorized For This Membership Change'],
  INVALID_ACTION: [400, 'That membership action is not supported'],
  MISSING_PARAMS: [400, 'Required Membership Details Are Missing'],
  INVITE_CODE_REQUIRED: [400, 'An Invite Or Share Code Is Required'],
  CANNOT_SELF_MANAGE: [403, 'Use The Leave-Group Action To Change Your Own Membership'],
  NOT_A_HOST: [403, 'Only The Owner Or An Approved Admin Can Manage Members'],
  CANNOT_MODIFY_OWNER: [403, 'The Group Owner Cannot Be Modified Here'],
  ADMIN_CANNOT_MODIFY_PEER: [403, 'Admins Cannot Modify Another Admin Or The Owner'],
  OWNER_ONLY_ACTION: [403, 'Only the group owner can change admin roles'],
  GROUP_NOT_FOUND: [404, 'Group Not Found'],
  MEMBER_NOT_FOUND: [404, 'Member Not Found'],
  GROUP_INACTIVE: [409, 'This Group Is Not Accepting Membership Changes'],
  ALREADY_OWNER: [409, 'You Already Own This Group'],
  ALREADY_MEMBER: [409, 'This Player Is Already A Member Of The Group'],
  MEMBERSHIP_CONFLICT: [409, 'Membership Changed During This Request. Refresh And Try Again.'],
  MEMBERSHIP_STATE_INVALID: [409, 'This membership is in an unsupported state'],
  MEMBER_IS_ACTIVE_GAME_HOST: [409, "Reassign Or Cancel This Member's Active Games Before Removing Them"],
  TARGET_NOT_PENDING: [409, 'This Membership Request Is No Longer Pending'],
  TARGET_NOT_BANNED: [409, 'This Member Is No Longer Banned'],
  TARGET_NOT_APPROVED: [409, 'Only An Approved Member Can Become An Admin'],
  ALREADY_ADMIN: [409, 'This Member Is Already An Admin'],
  TARGET_NOT_ADMIN: [409, 'This Member Is Not Currently An Admin'],
  OWNER_CANNOT_LEAVE: [409, 'Transfer Ownership Before Leaving The Group'],
  BANNED_CANNOT_LEAVE: [409, 'A banned membership must be resolved by the group owner'],
  RSVP_MEMBERSHIP_REQUIRED: [403, 'An Eligible Group Membership Is Required For This RSVP'],
  RSVP_MEMBERSHIP_BANNED: [403, 'A banned member cannot hold an active RSVP'],
  RSVP_MEMBERSHIP_DECLINED: [403, 'A declined member cannot hold an active RSVP'],
  RSVP_MEMBERSHIP_INVALID: [409, 'This membership cannot hold an active RSVP'],
  RSVP_MEMBER_INELIGIBLE: [409, 'This Membership Is Not Eligible For An Active RSVP'],
  RSVP_GAME_NOT_FOUND: [404, 'The Game For This RSVP No Longer Exists'],
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
      error: 'Membership Changed During This Request. Refresh And Try Again.',
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
