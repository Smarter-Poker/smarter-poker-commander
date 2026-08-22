/**
 * Venue scoping - ONE check, applied the same way everywhere.
 *
 * WHY THIS FILE EXISTS
 * `guardStaff` proves a staff session is valid. It does NOT prove which room
 * the session belongs to, and the tournament id is a URL parameter. So a
 * perfectly ordinary, correctly-signed session for venue A can name venue B's
 * tournament and act on it.
 *
 * As of 2026-08-22, 24 of the 41 routes under pages/api/tournaments did not
 * make that comparison. Seventeen did, which is what makes this a drift bug
 * rather than an unknown: the check was written seventeen times by hand and
 * omitted twenty-four times, and nothing anywhere reported the omission.
 * The worst of the twenty-four wrote: balance-execute reseated another room's
 * live tournament, clock could end it, eliminate could bust its players,
 * chips could rewrite their stacks, and register put cash into its drawer.
 *
 * THREE FORMS EXISTED AMONG THE SEVENTEEN THAT DID CHECK
 *   if (staff.venue_id && Number(...) !== Number(...))      <- fails OPEN on null/0
 *   if (staff.venue_id !== undefined && ...)                <- null passes through
 *   if (staff.venue_id !== undefined && staff.venue_id !== null && ...)
 * They disagree about the venueless session, so this helper settles it: a
 * session without a venue is REFUSED, never waved through.
 *
 * THAT IS SAFE, AND VERIFIED, NOT ASSUMED
 * `verifyStaffSession` already guarantees a real venue on both auth paths:
 *   - PIN sessions fail closed at auth.js:303 with NO_VENUE.
 *   - Owner sessions are looked up with .eq('venue_id', sessionData.venue_id),
 *     and the synthetic owner object is built with venue_id: sub.venue_id.
 * So no legitimate session reaching a route has a null venue_id, and failing
 * closed here cannot lock anybody out. It only removes the bypass.
 *
 * USAGE - two lines, immediately after the tournament row is loaded and its
 * not-found case handled:
 *
 *     if (denyCrossVenue(res, staff, tournament)) return;
 *
 * The tournament SELECT must include venue_id. A row whose venue_id is missing
 * is also refused: this helper never guesses.
 */

/**
 * True when `staff` and `row` belong to the same venue.
 *
 * Compared as strings, deliberately. venue_id is an integer on commander_staff
 * and commander_tournaments, but session payloads round-trip through JSON and
 * HMAC signing, where it has been observed as both 12 and "12". Number() would
 * also coerce null and '' to 0 and make them equal to a venue 0; String() does
 * not. Both sides are rejected before comparison anyway, so this is belt and
 * braces.
 */
export function isSameVenue(staff, row) {
  const a = staff?.venue_id;
  const b = row?.venue_id;
  if (a === undefined || a === null || a === '') return false;
  if (b === undefined || b === null || b === '') return false;
  return String(a) === String(b);
}

/**
 * Refuse a cross-venue request.
 *
 * Writes the 403 and returns true when the caller must stop; returns false
 * when the request may proceed. Written as a guard so the call site reads
 * `if (denyCrossVenue(res, staff, tournament)) return;` - one line, impossible
 * to half-apply.
 *
 * @param {object} res       Next.js response
 * @param {object} staff     the verified session from guardStaff
 * @param {object} row       any row carrying venue_id (usually the tournament)
 * @param {string} [subject] what was addressed, for the message
 * @returns {boolean} true when a 403 has been sent
 */
export function denyCrossVenue(res, staff, row, subject = 'Tournament') {
  if (isSameVenue(staff, row)) return false;

  // Deliberately does not say whether the id exists, which venue owns it, or
  // which venue the caller is in. A 403 that distinguishes "wrong venue" from
  // "no such tournament" is an enumeration oracle for every event id in the
  // platform.
  res.status(403).json({
    success: false,
    error: {
      code: 'WRONG_VENUE',
      message: `${subject} Belongs To A Different Venue`
    }
  });
  return true;
}

export default { isSameVenue, denyCrossVenue };
