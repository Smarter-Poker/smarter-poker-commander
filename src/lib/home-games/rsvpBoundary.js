export const MANAGER_RSVP_SELECT = `
  id,
  game_id,
  user_id,
  response,
  is_confirmed,
  bringing_guests,
  guest_names,
  message,
  seat_number,
  responded_at,
  updated_at,
  profiles:user_id (id, username, display_name, avatar_url)
`;

const RSVP_STATUSES = ['yes', 'maybe', 'no', 'waitlist', 'pending'];

export function toManagerRsvpDto(rsvp) {
  if (!rsvp) return null;
  const isConfirmed = rsvp.is_confirmed === true;
  // RSVPManager treats an unconfirmed "yes" as a host-approval request. Keep
  // the database response separately so player-facing callers still receive
  // the capacity trigger's authoritative yes/waitlist result.
  const managerStatus = rsvp.response === 'yes' && !isConfirmed
    ? 'pending'
    : rsvp.response;
  const profile = rsvp.profiles
    ? {
        id: rsvp.profiles.id || rsvp.user_id || null,
        username: rsvp.profiles.username || null,
        display_name: rsvp.profiles.display_name || 'Unknown Player',
        avatar_url: rsvp.profiles.avatar_url || null,
      }
    : {
        id: rsvp.user_id || null,
        username: null,
        display_name: 'Unknown Player',
        avatar_url: null,
      };

  return {
    id: rsvp.id,
    game_id: rsvp.game_id,
    user_id: rsvp.user_id,
    response: rsvp.response,
    status: managerStatus,
    is_confirmed: isConfirmed,
    bringing_guests: Number(rsvp.bringing_guests || 0),
    guest_count: Number(rsvp.bringing_guests || 0),
    guest_names: Array.isArray(rsvp.guest_names) ? rsvp.guest_names : [],
    message: rsvp.message || null,
    seat_number: rsvp.seat_number ?? null,
    seat_assignment: rsvp.seat_number ?? null,
    responded_at: rsvp.responded_at || null,
    // The RSVP table has responded_at rather than created_at. Preserve the UI
    // alias without querying a column that does not exist.
    created_at: rsvp.responded_at || null,
    updated_at: rsvp.updated_at || null,
    player_name: profile.display_name,
    profiles: profile,
  };
}

export function groupManagerRsvps(rsvps = []) {
  const grouped = Object.fromEntries(RSVP_STATUSES.map((status) => [status, []]));
  for (const rsvp of rsvps || []) {
    if (grouped[rsvp?.status]) grouped[rsvp.status].push(rsvp);
  }
  return grouped;
}

export default toManagerRsvpDto;
