# 2026-11-28 - No staff page white-screens on a bad API answer

## What was wrong

An API can legitimately answer with an error body, an empty object,
`data: null`, `data: []`, a 500 or a 401. Opening every staff route in the
header registry against each of those (510 page loads) found:

- Nine pages crashed to "Application error: a client-side exception":
  Time Clock, Table Vibes, System Info, Shift Handoff, Churn Prediction,
  Tax Compliance, Members, Tournament Director Control Center and TD Reports.
  Root cause everywhere: `json.data.entries || []` read straight off the
  response. `null.entries` throws, and on an array `[].entries` is
  `Array.prototype.entries` - a function that `|| []` keeps, which React then
  called as a state updater ("Cannot convert undefined or null to object").
  The Control Center also read `stats.player_stacks` with no `stats`.
- Four Tournament Director screens (Control Center, Chip Counts, Color Up,
  Dealer Rotation) drew their loading and error states outside
  CommanderLayout: no global header, no page image header, one button.

## The fix

- `src/lib/commander/apiShape.js`: `apiData(json)` (the payload, or `{}`),
  `asArray`, `asObject`, `asNumber`, `apiFailed(res, json)`,
  `apiError(res, json, what)` ("Could Not Load Members (500): reason"),
  `readJson(res)` (never throws).
- Every `x.data.field` read in `pages/commander` and
  `src/components/commander` (39 files) now goes through `apiData(x).field`
  or `asArray(x.data)`; array fallbacks are `asArray(...)`, not `|| []`.
- The nine pages normalise their answer once where it is fetched (defaults
  for every array, object and number they render) and show
  `src/components/commander/shared/LoadError.jsx` ("Could Not Load ...",
  Try Again) instead of an empty list when the answer failed.
- The four TD screens render loading and error inside CommanderLayout, with
  Try Again and Back To Control Center / Back To Tournaments.

## Regression guard

- `scripts/check-api-resilience.mjs`, run by the required CI `build` job on
  the build it just made: 85 routes x 6 answers (empty array, empty object,
  null data, error body, 500, 401); each page must draw its image header, the
  PIN gate, or (401) go to sign-in, with no uncaught error. Before: 29
  failures. After: 0.
- `tests/unit/apiShape.law.test.js`: the reader's semantics, no
  `x.data.field` reads left in staff pages, the nine pages and four TD screens
  keep their normaliser, retry and layout, and CI runs the check.
