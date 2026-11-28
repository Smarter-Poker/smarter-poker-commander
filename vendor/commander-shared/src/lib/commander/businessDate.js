/**
 * businessDate - the ONE place Commander decides what calendar day it is
 * (2026-11-28).
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * Forty-two call sites computed "today" as `new Date().toISOString().split('T')[0]`
 * (or `.slice(0, 10)`). That is the UTC calendar date. A poker room in Texas
 * runs on Central time, so from 6 PM Central (5 PM Mountain, 4 PM Pacific,
 * 7 PM Eastern) until midnight the UTC date is already TOMORROW: a close-day
 * written at 9 PM landed on the next day's `close_date`, the shift handoff on
 * the next `shift_date`, dealer rotations on the next `rotation_date`, the
 * daily report opened on a day that had not started, today's high hands
 * vanished, and a promotion ending today expired six hours early.
 *
 * The mirror-image defect: a date-only value parsed with `new Date('2026-11-28')`
 * is UTC MIDNIGHT, which every US time zone displays as the evening of the
 * 27th. Print headings, report labels and the W-2G tax year all read a day
 * (or a year, for January 1) early.
 *
 * THE RULE
 * --------
 * A business date is the calendar date AT THE VENUE. The venue's IANA zone
 * comes from `poker_venues.timezone`; when that is empty, from the venue's US
 * state; otherwise America/Chicago. A date key is `YYYY-MM-DD`. Date keys are
 * compared and stepped as plain calendar dates (never through a local Date),
 * and are displayed by formatting them in UTC at noon, which is the same day
 * in every runtime zone.
 *
 * This module is pure: no imports, no I/O. Club Commander re-exports it from
 * `src/lib/commander/businessDate.js` and carries the venue lookup
 * (`venueTimeZone.js`), the page hook (`src/hooks/useVenueTimeZone.js`) and
 * the law test that keeps the UTC idiom from coming back.
 */

export const DEFAULT_TIME_ZONE = 'America/Chicago';

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * US state (and DC / territories) -> the zone most of the state keeps.
 * States split across two zones get the zone of most of their population;
 * a venue in the minority part sets `poker_venues.timezone`, which wins.
 */
export const US_STATE_TIME_ZONES = Object.freeze({
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver',
  PR: 'America/Puerto_Rico', GU: 'Pacific/Guam', VI: 'America/St_Thomas',
});

const validZoneCache = new Map();

/** True when `tz` is an IANA zone this runtime can format in. */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  if (validZoneCache.has(tz)) return validZoneCache.get(tz);
  let ok = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    ok = true;
  } catch {
    ok = false;
  }
  validZoneCache.set(tz, ok);
  return ok;
}

/** Zone for a US state code ("TX", "tx", " TX "), or null. */
export function stateTimeZone(state) {
  if (typeof state !== 'string') return null;
  return US_STATE_TIME_ZONES[state.trim().toUpperCase()] || null;
}

/**
 * The venue's IANA zone: `timezone` when valid, else from `state`, else
 * `fallback` (America/Chicago). Accepts a poker_venues row, a home-game group
 * row, or anything carrying `timezone` / `state`.
 */
export function venueTimeZone(venue, fallback = DEFAULT_TIME_ZONE) {
  const tz = venue && typeof venue.timezone === 'string' ? venue.timezone.trim() : '';
  if (tz && isValidTimeZone(tz)) return tz;
  const fromState = stateTimeZone(venue?.state);
  if (fromState) return fromState;
  return isValidTimeZone(fallback) ? fallback : DEFAULT_TIME_ZONE;
}

/** The zone of the device running this code (the browser, on a page). */
export function browserTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(tz)) return tz;
  } catch { /* fall through */ }
  return DEFAULT_TIME_ZONE;
}

function resolveZone(timeZone) {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

const partsFormatterCache = new Map();
function partsFormatter(timeZone) {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of an instant in a zone. */
export function zonedParts(date, timeZone) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const out = {};
  for (const p of partsFormatter(resolveZone(timeZone)).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

function keyFromYmd(y, m, d) {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isDateKey(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_KEY_RE.exec(value);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return utcMsToKey(t) === value;
}

/**
 * The business date (YYYY-MM-DD) of `date` in `timeZone`.
 * Default: now, in America/Chicago. Returns null for an invalid date.
 */
export function businessDateKey(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const p = zonedParts(date, timeZone);
  if (!p) return null;
  return keyFromYmd(p.year, p.month, p.day);
}

function keyToUtcMs(key) {
  const m = DATE_KEY_RE.exec(String(key || ''));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function utcMsToKey(ms) {
  const d = new Date(ms);
  return keyFromYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** `key` plus `n` calendar days (n may be negative). Null for a bad key. */
export function addDaysToKey(key, n) {
  const ms = keyToUtcMs(key);
  if (Number.isNaN(ms)) return null;
  return utcMsToKey(ms + Math.round(Number(n) || 0) * DAY_MS);
}

/** Whole calendar days from `a` to `b` (b - a). NaN for a bad key. */
export function diffDaysKeys(a, b) {
  const ma = keyToUtcMs(a);
  const mb = keyToUtcMs(b);
  if (Number.isNaN(ma) || Number.isNaN(mb)) return NaN;
  return Math.round((mb - ma) / DAY_MS);
}

/** Day of week of a key, 0 = Sunday. NaN for a bad key. */
export function dayOfWeekOfKey(key) {
  const ms = keyToUtcMs(key);
  return Number.isNaN(ms) ? NaN : new Date(ms).getUTCDay();
}

/** The Sunday (weekStartsOn 0) or Monday (1) on or before `key`. */
export function startOfWeekKey(key, weekStartsOn = 0) {
  const dow = dayOfWeekOfKey(key);
  if (Number.isNaN(dow)) return null;
  return addDaysToKey(key, -((dow - weekStartsOn + 7) % 7));
}

/** Last day of the month `key` falls in. */
export function endOfMonthKey(key) {
  const m = DATE_KEY_RE.exec(String(key || ''));
  if (!m) return null;
  return utcMsToKey(Date.UTC(Number(m[1]), Number(m[2]), 0));
}

/** December 31 of the year `key` falls in. */
export function endOfYearKey(key) {
  const m = DATE_KEY_RE.exec(String(key || ''));
  return m ? `${m[1]}-12-31` : null;
}

/** Calendar year of a date key or of a `YYYY-MM-DD...` string, as a number. */
export function yearOfKey(value) {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(value || ''));
  return m ? Number(m[1]) : NaN;
}

/**
 * A date key as a Date at LOCAL noon of that day, so `toLocaleDateString()`,
 * `getDate()` and `getFullYear()` read the same calendar day in any US zone.
 * Use for date-only DB values (`start_date`, `event_date`). Invalid -> null.
 */
export function parseDateKey(key) {
  const m = DATE_KEY_RE.exec(String(key || '').slice(0, 10));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/**
 * Format a date key for display without any zone shifting it:
 * formatDateKey('2026-11-28', { weekday: 'long', month: 'long', day: 'numeric' })
 * -> "Saturday, November 28". Returns '' for a bad key.
 */
export function formatDateKey(key, options = { month: 'short', day: 'numeric', year: 'numeric' }, locale = 'en-US') {
  const ms = keyToUtcMs(String(key || '').slice(0, 10));
  if (Number.isNaN(ms)) return '';
  return new Date(ms + 12 * 60 * 60 * 1000).toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
}

/** Offset (ms) of `timeZone` from UTC at instant `ms`: wall clock minus UTC. */
function zoneOffsetMs(ms, timeZone) {
  const p = zonedParts(new Date(ms), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which wall-clock `key` + `hh:mm` occurs in `timeZone`.
 * In a spring-forward gap the later valid instant is returned; in a
 * fall-back overlap, the first occurrence.
 */
export function zonedTimeToDate(key, timeZone, hours = 0, minutes = 0) {
  const m = DATE_KEY_RE.exec(String(key || ''));
  if (!m) return null;
  const tz = resolveZone(timeZone);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hours, minutes);
  // The zone's offset twelve hours either side covers any one transition.
  const offBefore = zoneOffsetMs(wall - 12 * 60 * 60 * 1000, tz);
  const offAfter = zoneOffsetMs(wall + 12 * 60 * 60 * 1000, tz);
  const valid = [wall - offBefore, wall - offAfter]
    .filter((t) => t + zoneOffsetMs(t, tz) === wall);
  if (valid.length) return new Date(Math.min(...valid));
  // Spring-forward gap: the wall time does not exist; step past the gap.
  return new Date(wall - offBefore);
}

/** The instant the business day `key` begins at the venue (local midnight). */
export function zonedDayStart(key, timeZone) {
  return zonedTimeToDate(key, timeZone, 0, 0);
}

/**
 * The business day `key` as a half-open instant range for timestamptz
 * queries: `.gte(col, start).lt(col, end)`. Both are ISO strings with `Z`.
 * Handles 23- and 25-hour DST days. Null for a bad key.
 */
export function businessDayRange(key, timeZone) {
  const start = zonedDayStart(key, timeZone);
  const end = zonedDayStart(addDaysToKey(key, 1), timeZone);
  if (!start || !end) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

/** ISO instant the venue's current business day began. */
export function businessDayStartISO(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const start = zonedDayStart(businessDateKey(date, timeZone), timeZone);
  return start ? start.toISOString() : null;
}

/**
 * Value for an `<input type="datetime-local">` showing instant `value` in the
 * device's own zone (the zone `new Date(inputValue)` parses it back in), so
 * an edit-and-save round trip keeps the time. '' for an empty/invalid value.
 */
export function toDateTimeLocalValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${keyFromYmd(d.getFullYear(), d.getMonth() + 1, d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Start of a report window ending now: 'today' is the venue's business day
 * start; 'week' / 'month' / 'quarter' are rolling windows. Returns ISO.
 */
export function reportRangeStartISO(range, timeZone, now = new Date()) {
  const d = new Date(now);
  switch (range) {
    case 'week': return new Date(d.getTime() - 7 * DAY_MS).toISOString();
    case 'month': d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString();
    case 'quarter': d.setUTCMonth(d.getUTCMonth() - 3); return d.toISOString();
    case 'today':
    default:
      return businessDayStartISO(now, timeZone);
  }
}
