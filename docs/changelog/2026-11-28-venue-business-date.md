# 2026-11-28 - The business date is the venue's date, not the UTC date

## The defect

Commander wrote "today" as `new Date().toISOString().split('T')[0]` (or
`.slice(0, 10)`) in 42 places. That is the UTC calendar date. A Texas room
runs on Central time, so from 6 PM Central (5 PM Mountain, 4 PM Pacific,
7 PM Eastern) until midnight the UTC date is already tomorrow:

- `close_date` (close day), `shift_date` (shift handoff) and `rotation_date`
  (dealer scan-in) were stamped on the next day for every evening action.
- Reports, the cashier drawer, the time clock, high hands, dealer rotations,
  analytics and exports cut their day at UTC midnight (6 PM Central), so a
  room's busiest hours landed in the next day's numbers.
- Promotions with an `end_date` of today expired at 6 PM the evening before.
- The responsible-gaming daily limit summed spend from UTC midnight, so after
  6 PM Central the earlier spend did not count and the limit could be passed.
- Home-game RSVPs were refused as "already happened" for tonight's game.
- W-2G events and season-leaderboard scoring were dated on the UTC day.
- The schedule's "today" and week, the leaderboard / season / marketplace
  defaults and the daily-summary default all jumped a day early.

A second pattern: DATE values parsed with `new Date('YYYY-MM-DD')` are UTC
midnight, which every US zone shows as the previous evening. Print headings,
analytics labels, league and pilot dates read a day early, and the W-2G tax
year read the previous year for a January 1 event. A third: datetime-local
inputs were loaded from a UTC ISO slice but saved as local time, so every
edit-and-save moved an announcement six hours (Central).

## The fix

One shared module, `businessDate.js` (commander-shared #93, merged
150174f, vendored identically; `src/lib/commander/businessDate.js` is the
shim). The venue zone is `poker_venues.timezone`, else the zone of the
venue's US state, else America/Chicago (347 of 603 venues have a zone; the
rest have a state). Server routes read it with `fetchVenueTimeZone`
(`src/lib/commander/venueTimeZone.js`, ten-minute per-venue memo, never
throws). Pages use `src/hooks/useVenueTimeZone.js`, which is null on the
server and the first client render (hydration law) and then the cached or
browser zone, then the venue zone.

Day bounds for timestamptz queries are `businessDayRange` (local midnight to
local midnight, 23 and 25 hour DST days handled). DATE values are compared as
keys and displayed with `formatDateKey`, never through a local Date.

Money and tax paths: only how NEW dates are computed changed. Nothing was
backfilled or rewritten. The W-2G dedupe and the export packet's tax-event
lookup match either the venue-local day or the old UTC day, so events written
before this change are still found and never filed twice.

Also fixed on the way: `/api/commander/leaderboards/:id/entries` never
selected `start_date` / `end_date` and queried from "undefinedT00:00:00";
`/api/commander/reports/summary` ignored the `date` the Daily Summary page
sends, so every past day showed today's numbers.

## Law

`tests/unit/businessDate.law.test.js` fails on the `toISOString()` date cut
(`split('T')[0]`, `slice(0, 10)`, `slice(0, 16)`) anywhere in pages/, src/
or the vendored commander-shared (allowlist empty, each future entry needs a
reason), on bare `T00:00:00` / `T23:59:59` day bounds in API routes, and
pins the three stamped dates to the venue zone. `tests/unit/businessDate.test.js`
covers the module (Central/Eastern rollover, DST, Phoenix, state fallback,
key arithmetic, datetime-local round trip), the lookup and the SSR-null hooks.
