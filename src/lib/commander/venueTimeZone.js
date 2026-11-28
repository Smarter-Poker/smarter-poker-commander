/**
 * Look up a venue's IANA time zone from `poker_venues` (2026-11-28).
 *
 * Pairs with the pure `businessDate.js`. Server routes pass their existing
 * server client; pages may pass the browser client (poker_venues is
 * public-read). The answer is the venue's `timezone`, else the zone of its US
 * state, else America/Chicago (see `venueTimeZone`). A failed read never
 * throws: it falls back the same way, so a date stamp is never blocked by a
 * lookup.
 *
 * Results are memoised per venue for ten minutes in this process: a venue's
 * zone changes about never, and a route that stamps several dates must not
 * read the same row each time.
 */
import { DEFAULT_TIME_ZONE, venueTimeZone } from './businessDate';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export async function fetchVenueTimeZone(client, venueId) {
  if (venueId === undefined || venueId === null || venueId === '') return DEFAULT_TIME_ZONE;
  const key = String(venueId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tz;
  let tz = DEFAULT_TIME_ZONE;
  try {
    const { data, error } = await client
      .from('poker_venues')
      .select('timezone, state')
      .eq('id', venueId)
      .maybeSingle();
    if (error) throw error;
    tz = venueTimeZone(data);
    cache.set(key, { tz, at: Date.now() });
  } catch (err) {
    console.warn('[venueTimeZone] lookup failed, using fallback:', err?.message || err);
  }
  return tz;
}

/** Test hook: forget memoised zones. */
export function clearVenueTimeZoneCache() {
  cache.clear();
}
