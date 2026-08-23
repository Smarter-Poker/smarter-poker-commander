/**
 * Tournament payload shape validation - one copy.
 *
 * This function existed TWICE, byte for byte identical: exported from
 * pages/api/tournaments/index.js (create) and re-declared privately in
 * pages/api/tournaments/[id].js (update). The exported one was imported by
 * nothing, so the two were free to drift, and a rule tightened on create would
 * simply not apply on update - which is the half that runs after an event is
 * already live and has entries in it.
 *
 * This is the SHAPE check only: is blind_structure an array with a playing
 * level, do the payout percentages total ~100, does paying_places fit inside
 * max_entries. Whether the structure can actually be RUN - blinds that go up,
 * antes under the big blind, real durations, no break on row one - is
 * structureRejection() in structureValidation.js, and both callers run that
 * separately.
 */

/**
 * @param {object} body               the request body
 * @param {object} [opts]
 * @param {boolean} [opts.partial]    true for PATCH: absent fields are allowed
 * @returns {string|null} an error message, or null when the payload is fine
 */
export function validateTournamentPayload(body, { partial = false } = {}) {
  const { blind_structure, payout_structure, paying_places, max_entries } = body || {};

  // blind_structure must be a non-empty array with at least one playing level.
  if (blind_structure !== undefined) {
    let bs = blind_structure;
    if (typeof bs === 'string') { try { bs = JSON.parse(bs); } catch { bs = null; } }
    if (!Array.isArray(bs) || bs.length === 0) return 'blind_structure Must Be A Non-Empty Array Of Levels';
    if (!bs.some(l => l && !l.is_break)) return 'blind_structure Must Contain At Least One Playing Level';
  } else if (!partial) {
    return 'blind_structure Is Required And Must Be A Non-Empty Array Of Levels';
  }

  // payout_structure (canonical array of { place, pct }) must total ~100%.
  if (Array.isArray(payout_structure) && payout_structure.length > 0) {
    const sum = payout_structure.reduce((s, p) => s + (Number(p && (p.pct != null ? p.pct : p.percentage)) || 0), 0);
    if (Math.abs(sum - 100) > 0.5) return `payout_structure Percentages Must Total ~100% (Got ${sum.toFixed(2)}%)`;
  }

  // paying_places cannot exceed the entries cap.
  const cap = (max_entries !== undefined && max_entries !== null && max_entries !== '') ? parseInt(max_entries) : null;
  if (cap && Number.isFinite(cap) && paying_places != null && parseInt(paying_places) > cap) {
    return `paying_places (${paying_places}) Cannot Exceed max_entries (${cap})`;
  }

  return null;
}

export default validateTournamentPayload;
