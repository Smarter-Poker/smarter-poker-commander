# Club Commander -- Agent Instructions

## START HERE: current operating references

Read root `AGENTS.md`, `AGENT-PLAYBOOK.md` and `docs/agent-policy/REFERENCE-INDEX.md` at task start and every resumption. They link to the current owner policy, operating law and hardening standard. Read `PUBLISHING.md` for delivery. Later owner instructions govern operating authority; the product and financial laws below remain applicable within the assigned scope. Historical programmes are not automatic assignments.

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

Follow `PUBLISHING.md`: owned branch, required `build` check, protected merge and the existing Vercel Git integration. The authorized agent handles the PR and merge; disabled autopilot is not a dependency. Verify the actual production deployment and the direct/proxied application behavior. Documentation-only changes may be intentionally ignored by the provider; verify source integration without claiming a new runtime deployment.

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

**3.2 Error visibility is local.** Auth failures are recorded in the browser
console. Server failures remain in server logs and the existing venue health
metrics. The login-bridge probe preserves its HTTP result,
`cron_execution_log` record and the existing dispatcher SMS path. No external
error-reporting SDK, ingest probe or paid monitoring integration is installed.
Do not restore one without an explicit owner request.

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
  it) and preserves server-log diagnostics on failure.
  **Auth is a hub-signed ticket, not a CRON_SECRET copy** (since 2026-09-04,
  after the first live run 401'd on a drifted copy): the dispatcher calls the
  hub's `/api/internal/login-bridge-probe` with CRON_SECRET like every other
  job, and the hub relays here with `X-Probe-Ticket`, an HMAC over the
  minute signed with `SUPABASE_JWT_SECRET` - which both projects hold by
  construction (one Supabase project). `src/lib/probe/ticket.js` is
  byte-identical to the hub's `src/lib/probeTicket.js`; both pin one vector.
  Do not "simplify" this back to a shared CRON_SECRET.
- **Secondary: `.github/workflows/login-bridge-probe.yml`** runs the CLI
  `scripts/probe-login-bridge.mjs` plus `tests/e2e/login-bridge.spec.ts`
  (Playwright) every 30 minutes and on relevant merges. It files ONE
  self-closing issue labelled `login-bridge-probe`. If that issue is open,
  sign-in is or was broken. Its signed-in leg needs the `PROBE_EMAIL` /
  `PROBE_PASSWORD` secrets on THIS repo (not Club Arena's).

- **Before merge: the same probe runs against the pull request.** The
  required `build` job in `ci.yml` starts the build it just made
  (`next start`, no secrets) and runs the structural leg in local mode
  (`PROBE_LOCAL=1`). A free `completeLogin(` call in the login chunk fails
  the PR. Vercel preview URLs are SSO-protected on this project, so the
  local build is what gets probed.
- **The browser leg runs the hop users take** - signed in on the hub, nothing
  on the commander origin, press Continue, dashboard with no password - in
  desktop Chromium, desktop WebKit and an iPhone-sized mobile Safari
  (`playwright.config.ts`). The incident report's first line was "issues
  with mobile"; a Chromium-only suite would have called it green.
- **A failing Open Claw run pages.** The hub dispatcher lists the probe in
  `CRITICAL_JOBS` (two consecutive non-200s, including a 401 from
  `CRON_SECRET` drift, send an SMS through its existing alert path; one
  recovery SMS when it is 200 again).

Runbook: `docs/runbooks/login-bridge.md`.

## 5. Runbooks

- `docs/runbooks/login-bridge.md` - the handshake, its guards, triage.
- `docs/runbooks/staff-session-secret-rotation.md` - rotating the HMAC secret.
- `docs/runbooks/cross-subdomain-session.md` - the one-session design, why
  it is not a hotfix (refresh-token rotation), and the 2026-09-04 decision
  NOT to build it yet with the three conditions that would reopen it. Do not
  start it as a side quest; it is a Tier 3 hub programme Dan approves.
- `docs/changelog/` - one file per change, never appended to a shared one.

## 6. Working rules (Dan's, binding, same as every repo)

One step at a time; verify on real hardware; no emoji in source; horses are
players; never auto-switch tables; write it down in your own changelog file.
