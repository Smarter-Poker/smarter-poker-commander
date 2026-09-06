/**
 * Normalize the two RSVP guest-count DTOs used across Commander generations.
 * The database/API field is `bringing_guests`; `guest_count` remains a legacy
 * compatibility alias on a few older responses.
 */
export function rsvpGuestCount(rsvp = {}) {
  const value = Number(rsvp?.bringing_guests ?? rsvp?.guest_count ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/** Count occupied/requested seats, not RSVP party rows. */
export function rsvpSeatCount(rsvps = []) {
  if (!Array.isArray(rsvps)) return 0;
  return rsvps.reduce((total, rsvp) => total + 1 + rsvpGuestCount(rsvp), 0);
}
