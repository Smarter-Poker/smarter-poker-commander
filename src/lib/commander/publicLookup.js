/**
 * Public Lookup Outcomes
 *
 * WHY THIS EXISTS
 * ---------------
 * 2026-09-18. Commander's Supabase key stopped being registered for the
 * project, so every `poker_venues` read came back as an error. The venue
 * detail route read
 *
 *   if (venueError || !venue) return res.status(404) NOT_FOUND
 *
 * so for the whole outage `/api/venues/3109` told the world that Grand
 * Victoria Casino DOES NOT EXIST. It exists. The lookup was broken.
 *
 * That collapse is not a cosmetic wording problem. The World Hub renders
 * `/hub/commander/venues/[id]` from this route on the server and passes the
 * status straight through to the visitor and to Googlebot
 * (`src/lib/commander/venueSeo.js` in hub-vanguard maps 404 to `not-found`
 * and anything else to `unavailable`). A 404 invites a crawler to drop the
 * URL from the index; a 503 with `Retry-After` asks it to come back. One
 * mislabelled status turns a backend incident into lost rankings that take
 * weeks to win back.
 *
 * THE RULE: a lookup that FAILED and a record that IS NOT THERE are different
 * answers and get different statuses. Only a clean read of an empty result is
 * allowed to say 404.
 */

/** How long a crawler or client is asked to wait before retrying. */
export const LOOKUP_RETRY_AFTER_SECONDS = 120;

/**
 * Classify the two-value result PostgREST hands back.
 *
 * outcome({ error, record }) ->
 *   { kind: 'ok',          status: 200 }
 *   { kind: 'missing',     status: 404, body }   the read worked, the row is not there
 *   { kind: 'unavailable', status: 503, body, retryAfter }  the read itself failed
 *
 * `noun` names the thing in the 404 message ('Venue' -> 'Venue not found').
 */
export function lookupOutcome({ error, record, noun = 'Record' } = {}) {
  if (error) {
    return {
      kind: 'unavailable',
      status: 503,
      retryAfter: LOOKUP_RETRY_AFTER_SECONDS,
      body: {
        success: false,
        error: {
          code: 'UPSTREAM_UNAVAILABLE',
          message: `${noun} Lookup Is Temporarily Unavailable. Try Again Shortly.`
        }
      }
    };
  }

  if (!record) {
    return {
      kind: 'missing',
      status: 404,
      retryAfter: null,
      body: {
        success: false,
        error: { code: 'NOT_FOUND', message: `${noun} not found` }
      }
    };
  }

  return { kind: 'ok', status: 200, retryAfter: null, body: null };
}

/**
 * Send a non-ok outcome. Returns true when a response was sent, so a route
 * reads:
 *
 *   const outcome = lookupOutcome({ error: venueError, record: venue, noun: 'Venue' });
 *   if (sendLookupFailure(res, outcome)) return;
 *
 * `no-store` matters as much as the status: a cached 503 outlives the incident
 * it describes.
 */
export function sendLookupFailure(res, outcome) {
  if (!outcome || outcome.kind === 'ok') return false;

  if (outcome.retryAfter != null && typeof res.setHeader === 'function') {
    res.setHeader('Retry-After', String(outcome.retryAfter));
    res.setHeader('Cache-Control', 'no-store');
  }

  res.status(outcome.status).json(outcome.body);
  return true;
}
