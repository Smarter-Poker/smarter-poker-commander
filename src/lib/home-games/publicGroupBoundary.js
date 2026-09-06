const APPROVED_MEMBER_ROLES = new Set(['owner', 'admin']);
const JOIN_STATUSES = new Set(['approved', 'pending']);

// This projection is safe before authentication. owner_id is needed to decide
// whether a signed-in caller owns the resource, but toPublicGroup deliberately
// controls every field that crosses the response boundary.
export const PUBLIC_GROUP_SELECT = `
  id,
  name,
  description,
  tagline,
  owner_id,
  club_code,
  is_private,
  requires_approval,
  city,
  state,
  default_game_type,
  default_stakes,
  typical_buyin_min,
  typical_buyin_max,
  max_players,
  typical_day,
  typical_time,
  frequency,
  member_count,
  games_hosted,
  cover_photo_url,
  profile_photo_url,
  created_at,
  profiles:owner_id (id, display_name, avatar_url)
`;

// This projection is queried only after owner/admin authorization. It remains
// explicit so a new database column cannot silently become an API field.
export const STAFF_GROUP_SELECT = `
  id,
  name,
  description,
  tagline,
  owner_id,
  club_code,
  invite_code,
  qr_code_url,
  is_private,
  requires_approval,
  city,
  state,
  zip_code,
  latitude,
  longitude,
  default_game_type,
  default_stakes,
  typical_buyin_min,
  typical_buyin_max,
  max_players,
  typical_day,
  typical_time,
  frequency,
  member_count,
  games_hosted,
  cover_photo_url,
  profile_photo_url,
  tags,
  auto_generate_games,
  auto_generate_weeks_ahead,
  auto_ban_after_flakes,
  is_21_plus,
  is_charity,
  charity_beneficiary,
  smoking_policy,
  messenger_conversation_id,
  settings,
  contact_phone,
  website_url,
  is_active,
  created_at,
  updated_at,
  profiles:owner_id (id, display_name, avatar_url)
`;

export const PUBLIC_GAME_SELECT = `
  id,
  title,
  scheduled_date,
  start_time,
  status,
  rsvp_yes,
  max_players
`;

export const MEMBER_SELECT = `
  id,
  user_id,
  role,
  status,
  games_attended,
  profiles:user_id (id, display_name, avatar_url)
`;

function hostProfile(group) {
  const profile = group?.profiles;
  return profile
    ? {
        id: profile.id || group.owner_id || null,
        display_name: profile.display_name || 'Unknown Host',
        avatar_url: profile.avatar_url || null,
      }
    : {
        id: group?.owner_id || null,
        display_name: 'Unknown Host',
        avatar_url: null,
      };
}

export function toPublicGroup(group, membership = null) {
  if (!group) return null;

  return {
    id: group.id,
    name: group.name,
    description: group.description || null,
    tagline: group.tagline || null,
    owner_id: group.owner_id || null,
    club_code: group.club_code || null,
    is_private: Boolean(group.is_private),
    requires_approval: group.requires_approval !== false,
    city: group.city || null,
    state: group.state || null,
    default_game_type: group.default_game_type || null,
    default_stakes: group.default_stakes || null,
    typical_buyin_min: group.typical_buyin_min ?? null,
    typical_buyin_max: group.typical_buyin_max ?? null,
    max_players: group.max_players ?? null,
    typical_day: group.typical_day || null,
    typical_time: group.typical_time || null,
    frequency: group.frequency || null,
    member_count: Number(group.member_count || 0),
    games_hosted: Number(group.games_hosted || 0),
    cover_photo_url: group.cover_photo_url || null,
    profile_photo_url: group.profile_photo_url || null,
    created_at: group.created_at || null,
    profiles: hostProfile(group),
    ...(membership ? { my_membership: membership } : {}),
  };
}

export function toStaffGroup(group) {
  if (!group) return null;

  return {
    ...toPublicGroup(group),
    invite_code: group.invite_code || null,
    qr_code_url: group.qr_code_url || null,
    zip_code: group.zip_code || null,
    latitude: group.latitude ?? null,
    longitude: group.longitude ?? null,
    tags: Array.isArray(group.tags) ? group.tags : [],
    auto_generate_games: Boolean(group.auto_generate_games),
    auto_generate_weeks_ahead: group.auto_generate_weeks_ahead ?? null,
    auto_ban_after_flakes: group.auto_ban_after_flakes ?? null,
    is_21_plus: group.is_21_plus !== false,
    is_charity: Boolean(group.is_charity),
    charity_beneficiary: group.charity_beneficiary || null,
    smoking_policy: group.smoking_policy || null,
    messenger_conversation_id: group.messenger_conversation_id || null,
    settings: group.settings && typeof group.settings === 'object' ? group.settings : {},
    contact_phone: group.contact_phone || null,
    website_url: group.website_url || null,
    is_active: group.is_active !== false,
    updated_at: group.updated_at || null,
  };
}

export function toMemberDto(member) {
  if (!member) return null;
  const profile = member.profiles;
  return {
    id: member.id,
    user_id: member.user_id,
    role: member.role,
    status: member.status,
    games_attended: Number(member.games_attended || 0),
    profiles: profile
      ? {
          id: profile.id || member.user_id,
          display_name: profile.display_name || 'Unknown Member',
          avatar_url: profile.avatar_url || null,
        }
      : {
          id: member.user_id,
          display_name: 'Unknown Member',
          avatar_url: null,
        },
  };
}

export function determineGroupAccess({ group, userId, membership, viaInviteCode = false }) {
  const isOwner = Boolean(userId && group?.owner_id === userId);
  const isApprovedMember = membership?.status === 'approved';
  const isAdmin = isOwner || (
    isApprovedMember && APPROVED_MEMBER_ROLES.has(membership?.role)
  );
  const mayReadMembers = isOwner || isApprovedMember;
  const isPreview = Boolean(group?.is_private && !mayReadMembers && viaInviteCode);
  const allowed = Boolean(group && (!group.is_private || mayReadMembers || isPreview));

  return {
    allowed,
    isPreview,
    isOwner,
    isAdmin,
    mayReadMembers,
    mayReadPrivilegedGroup: isAdmin,
  };
}

export function allowsDeclinedReRequest(settings) {
  return settings?.allow_declined_re_request === true;
}

export function normalizeJoinResult(result) {
  if (!result || result.success !== true) return null;
  const status = result.status || result.membership?.status || null;
  if (!JOIN_STATUSES.has(status)) return null;

  return {
    status,
    membership: {
      id: result.membership?.id || result.member_id || null,
      status,
      role: result.membership?.role || result.role || 'member',
    },
  };
}
