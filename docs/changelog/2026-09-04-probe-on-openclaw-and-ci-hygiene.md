# 2026-09-04 - The probe gets a real cron, CI loses its advisory lint, and the cookie session is decided

## Probe on Open Claw (primary schedule)

- `src/lib/probe/loginBridgeProbe.mjs` is the probe core (`runLoginBridgeProbe`).
  It reads no credentials itself; callers pass them. The CLI
  `scripts/probe-login-bridge.mjs` (GitHub cron, files the issue) is a thin
  wrapper over it.
- `pages/api/internal/login-bridge-probe.js`: the Open Claw entry point.
  `Authorization: Bearer <CRON_SECRET>` (timing-safe), 503 with a clear message
  until `CRON_SECRET` exists on the commander Vercel project, runs both legs
  with `PROBE_LOGIN_EMAIL`/`PROBE_LOGIN_PASSWORD` (already set), records the
  run in `cron_execution_log` as `/commander/internal/login-bridge-probe` so the
  hub's cron watchdogs see it, and sends `commander.probe.login_bridge_failed`
  to Sentry on failure (alert rule 17436248).
- World Hub dispatcher: `('/api/commander/internal/login-bridge-probe', minute=22)`
  (PR #1327; `deploy-openclaw.yml` ships it on merge). The hub rewrite
  `/api/commander/*` -> commander is what makes the same bearer work.
- `lint:undef` now covers `src/**/*.mjs`; it caught a dropped `let` during the
  extraction.

Dan-only: set `CRON_SECRET` on `smarter-poker-commander` (same value as
hub-vanguard's production value, which is a sensitive env and cannot be read
by an agent). Until then the hourly job logs a 503 in the dispatcher journal.

## Push-trigger probe waits for the real deploy

The 09:09 run today probed `/api/staff-session/renew` four minutes after the
merge that added it, before Vercel had finished building, got a 404 and filed
a false incident. Both jobs in `login-bridge-probe.yml` now poll `/api/health`
for `version == GITHUB_SHA` (up to 10 minutes) instead of sleeping.

## CI: no advisory lint (law 3.1)

`next lint` had no ESLint config, prompted interactively and could not fail.
Deleted from `ci.yml` and `package.json`. `eslint.undef.config.mjs` (blocking)
now also carries ESLint's bug-class rules - every one at zero hits when added.
Not included: `no-unused-vars` (1,642 hits of style noise) and
`react-hooks/rules-of-hooks` (the installed plugin crashes on ESLint 9's flat
scope API).

## Small things

- CommanderLayout club switcher: `window.alert` on refusal -> inline
  dismissible notice (`role=status`). Same change upstream (commander-shared #58).
- `@supabase/ssr` removed: nothing imported it.
- A stash found in `~/Documents/commander-shared` (brushed-nickel nav pills,
  unreviewed, from another session) is preserved on
  `backup/brushed-nickel-nav-pills-2026-09-04` - the `backup/` namespace is
  excluded from auto-PR, so it is kept, not shipped.

## Same-origin cookie session: decided, not built

`docs/runbooks/cross-subdomain-session.md` now carries the decision and the
three conditions that reopen it. Short version: the hop it would remove is now
the best-watched path on the platform, the change is a hub-wide storage flip
(Tier 3, Dan's), and refresh-token rotation makes a half-migration dangerous.
