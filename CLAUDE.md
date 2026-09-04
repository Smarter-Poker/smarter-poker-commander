# Club Commander -- Agent Instructions

## START HERE: `AGENT-PLAYBOOK.md`

Read [`AGENT-PLAYBOOK.md`](./AGENT-PLAYBOOK.md) before this file. It is
byte-identical across all seven estate repos and says how to ship without
losing work: claim a worktree, commit, push a branch, stop. This file is the
Commander detail underneath it. If the two disagree, the playbook wins.

## 1. What this repo is

The Club Commander app (`commander.smarter.poker`), a Next.js 14 Pages Router
app on Vercel (project `smarter-poker-commander`). The World Hub rewrites
`smarter.poker/commander/*` and `smarter.poker/api/commander/*` here, so the
same code is reachable from both origins. Production `assetPrefix` pins every
`/_next/*` asset to `commander.smarter.poker` so the proxied pages actually
run (they did not, until 2026-09-03).

Shared UI/lib code is the **vendored** copy of `commander-shared` at
`vendor/commander-shared/` (installed as `@smarter-poker/commander-shared`
via `file:`). Section 4 says what that costs and how not to pay it twice.

## 2. How a change ships

Push a branch. `agent-open-pr.yml` opens the PR, `agent-autopilot.yml`
squash-merges it when the required `build` check is green, Vercel deploys
`main`. Verify with `curl -s https://commander.smarter.poker/api/health` -
`version` must equal the squash commit. `vercel.json`'s `ignoreCommand` skips
the build when only non-app files changed (`.md`, `.mjs`, `.yml`...), so a
merge that touches only `scripts/` or `docs/` does **not** redeploy - if you
need env changes applied, a redeploy of the current production deployment is
the way (`vercel redeploy <url>`), never `vercel --prod` from a laptop.

Required check: `build` in `ci.yml`. It runs, in order, the vendor drift
guard, the vendor <-> upstream ratchet, `npm install`, **`npm run lint:undef`
(blocking: `no-undef` plus ESLint's bug-class rules)**, `npm test`,
`next build`. There is no advisory lint any more (3.1).

## 3. LAWS (each one is an incident; read the changelog it names)

**3.1 An advisory check is not a check.** `next lint` has been red for months
and CI printed `completeLogin is not defined` on every build while every
production login failed with that exact ReferenceError (2026-09-03). The
`no-undef` rule now runs as a BLOCKING step (`eslint.undef.config.mjs`,
joined 2026-09-04 by the bug-class rules - dupe keys, unreachable code,
const reassignment, bad typeof, fallthrough - all at zero when added). The
advisory `next lint` step was DELETED the same day: it had no config and
prompted interactively, so it could not fail. Never add `continue-on-error`
to a check that can name a user-facing failure. If a check is too noisy to
block on, delete it or fix it; do not leave it advisory.

**3.2 A Sentry dashboard showing 0 issues is not health.** Client Sentry was
never loaded in this app (the config file needs `withSentryConfig` or a manual
import - `pages/_app.js` now does the import), and separately the org's error
quota had been exhausted since 2026-08-24 so EVERY event on the estate was
answered 429 for eleven days. `/api/health` exposes `observability.*` and
`auth.*` booleans, and the login-bridge probe posts one event per run and
WARNs on 429. When you touch monitoring, prove an event arrives - do not
trust the absence of red.

**3.3 The staff session is minted in ONE place.** `completeCommanderLogin()` in
`vendor/commander-shared/src/lib/commander/staffSession.js` (shimmed at
`src/lib/commander/staffSession.js`). login.js, auth/sso.js, the club
switcher and the 401 self-heal all call it. Two private copies drifted apart
once and one of them vanished; that was the outage. `tests/unit/
loginBridge.law.test.js` pins this. Do not write `commander_staff` anywhere
else.

**3.4 A stale derived token is never a reason to ask for a password.** The
Supabase session is the platform session. The HMAC-signed `x-staff-session`
is DERIVED from it (24h TTL, `src/lib/commander/auth.js`). When it goes
stale, `commanderFetch` re-mints it from the live session and retries BEFORE
announcing a 401; the login page re-mints silently on `?expired=1`. "Your
Session Is Not Valid" is for a platform session that is actually gone.

**3.5 Vendor edits go upstream in the same change.** Anything you change under
`vendor/commander-shared/src/` must land in `Smarter-Poker/commander-shared`
too, or the next sync overwrites your fix with the old bug (upstream was
BEHIND vendor by two weeks on 2026-09-03 and still fabricated HTTP 200s for
401s). `scripts/check-vendor-upstream-sync.mjs` (CI, blocking) fails on any vendor
file that differs from upstream main and is not listed in
`scripts/ci/vendor-upstream-divergence.json` - the RATCHET. That list is the
historical debt (54 files on 2026-09-04, each with a reason and a direction)
and may only shrink. `scripts/sync-vendor-from-upstream.sh <path>` brings a
file up to date. The order is: upstream PR first, wait for its merge, then
sync, then the consumer PR.

**3.6 The one auth authority is `src/lib/commander/auth.js`.** Bearer JWT via
`getUser`/`guardUser`, signed staff session via `guardStaff`/`guardManager`.
`middleware.ts` gates the admin PIN and nothing else. Do not add a second
Supabase client, cookie reader or secret anywhere - unexplained 401s come
from second opinions.

**3.7 Never track `node_modules`, not even a symlink.** `.gitignore` carries
both `node_modules` and `node_modules/`; the law test checks the index.

## 4. The probe is the truth about production

The probe core is `src/lib/probe/loginBridgeProbe.mjs` (`runLoginBridgeProbe`).
It reads no credentials itself; two callers pass their own:

- **Primary schedule: Open Claw on Hetzner, hourly at :22** (since 2026-09-04;
  hub CLAUDE.md 10.9 forbids the Claude scheduler, 11 routes every scheduled
  trigger through Open Claw). The hub dispatcher fires
  `smarter.poker/api/commander/internal/login-bridge-probe`, the hub rewrite
  lands on `pages/api/internal/login-bridge-probe.js`, which checks the
  `CRON_SECRET` bearer, runs both legs with `PROBE_LOGIN_EMAIL`/`_PASSWORD`
  (Vercel env on this project), writes its run to `cron_execution_log` as
  `/commander/internal/login-bridge-probe` (so the hub's cron watchdogs see
  it) and sends `commander.probe.login_bridge_failed` to Sentry on failure.
  It answers 503 until `CRON_SECRET` is set on THIS Vercel project with the
  hub-vanguard value (Dan-only: it is a sensitive env there).
- **Secondary: `.github/workflows/login-bridge-probe.yml`** runs the CLI
  `scripts/probe-login-bridge.mjs` plus `tests/e2e/login-bridge.spec.ts`
  (Playwright) every 30 minutes and on relevant merges. It files ONE
  self-closing issue labelled `login-bridge-probe`. If that issue is open,
  sign-in is or was broken. Its signed-in leg needs the `PROBE_EMAIL` /
  `PROBE_PASSWORD` secrets on THIS repo (not Club Arena's).

Runbook: `docs/runbooks/login-bridge.md`.

## 5. Runbooks

- `docs/runbooks/login-bridge.md` - the handshake, its guards, triage.
- `docs/runbooks/staff-session-secret-rotation.md` - rotating the HMAC secret.
- `docs/runbooks/sentry-auth-alerts.md` - rule ids, the quota, what to check.
- `docs/runbooks/cross-subdomain-session.md` - the one-session design, why
  it is not a hotfix (refresh-token rotation), and the 2026-09-04 decision
  NOT to build it yet with the three conditions that would reopen it. Do not
  start it as a side quest; it is a Tier 3 hub programme Dan approves.
- `docs/changelog/` - one file per change, never appended to a shared one.

## 6. Working rules (Dan's, binding, same as every repo)

One step at a time; verify on real hardware; no emoji in source; horses are
players; never auto-switch tables; write it down in your own changelog file.
