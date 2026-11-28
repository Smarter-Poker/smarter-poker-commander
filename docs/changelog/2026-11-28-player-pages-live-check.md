# Signed-in live check: World Hub player pages and the venue business date (2026-11-28)

## Why

The staff census (`tests/e2e/staff-headers.spec.ts`, PR #171) opens every
Club Commander staff page signed in, in production. Two things it could not
see:

1. The 37 player pages under `https://smarter.poker/hub/commander/*` (World
   Hub `pages/hub/commander/**`). They got the #SmarterDesign image header,
   the approved global header and the painted "?" this week, but no
   signed-in browser had opened them.
2. The business date. PR #175 moved every "today" from the UTC date to the
   venue's calendar date. The defect only showed from 6 PM Central to
   midnight, and only unit tests pinned the fix.

## What runs

Both in the EXISTING e2e job of `.github/workflows/login-bridge-probe.yml`
(no new workflow, no new `schedule:`; it runs on that workflow's 30-minute
cron, `workflow_dispatch`, and merges touching the specs or the code they
check), after the staff census:

- `tests/e2e/player-pages.spec.ts`. The job sparse-checks-out
  `Smarter-Poker/Smarter-Poker-World-Hub` `pages/hub/commander` and the spec
  derives the route list from those files on every run, so a new player
  page is covered by the next run with no edit here. Signed in as the probe
  account on smarter.poker (password grant, session under
  `localStorage['smarter-poker-auth']`, the platform session every hub page
  reads), each page at 393px and 1280px must show exactly one
  `.approved-global-header`, exactly one `header.cmd-header-full,
  header.cmd-header-bar` and exactly one `.sd-header-help`, no uncaught
  `pageerror`, no "Application error", and no bounce to sign-in. The two
  non-pages (`home-games/join`, an invite-redeem hop opened without a code
  so it never joins anything; `tournament/[id]/clock`, a full-screen clock)
  must show no image header and no "?". Dynamic routes get real ids from the
  reads the list pages already make (venues, active tournaments, active
  leagues, the probe's home games / squads / hand sessions) or are skipped
  with an annotation, never faked. At least 26 routes must be visited.
  Read-only: any non-GET request to `/api/commander/*` fired on page load is
  aborted and fails that page. Screenshots go to the
  `player-page-screenshots` artifact (14 days).
- `tests/e2e/business-date.spec.ts`. Mints the probe's signed staff session
  (the silent `/commander/login` hop), reads `GET /api/reports/daily` for the
  probe venue with no date (the route answers `businessDateKey(now,
  fetchVenueTimeZone(venue))`, the derivation every stamped date uses), and
  compares it with the date computed independently from Intl in the venue's
  zone (its public `poker_venues` row: timezone, else US state, else
  America/Chicago), sampled before and after the request so a run across
  midnight still has one right answer. Whenever the venue date differs from
  the UTC date (6 PM to midnight Central for a Central venue; the 30-minute
  schedule lands in that window every evening) it also asserts the server
  did not answer the UTC date, and the step summary says the evening window
  was exercised.

## Cannot pass silently

- `PROBE_SECRETS_REQUIRED` is `true` on the canonical repository
  (`github.repository == 'Smarter-Poker/smarter-poker-commander'`). There a
  missing `PROBE_EMAIL` / `PROBE_PASSWORD` fails all three signed-in steps
  (`::error`, exit 1) and the specs throw (`assertProbeSecrets` in
  `tests/e2e/probeSession.ts`). On a fork the old notice-and-skip stays.
- No retries (`--retries=0` and `retries: 0` in the spec); soft assertions so
  one run names every failing page.
- Each census uploads its screenshots before the next Playwright run starts,
  because Playwright empties `test-results/` at the start of every run.
- e2e job timeout 50 -> 80 minutes.

Law: `tests/unit/playerPagesCensus.law.test.js`.

## Follow-up: failures are readable without log access

The first live run (run 46168336724, 11:26 AM Central) visited 31 of 37
player routes and failed, but Actions logs need authentication, so the
failing pages were not visible from outside. The spec now prints one
`[player-pages] FAILURES (n): ...` line naming every failed assertion with
its received value, and the step raises it as one `::error` annotation and
adds it to the step summary.
