# 2026-09-03 - Commander sign-in outage: root causes, fixes, guards

## What users saw

`commander.smarter.poker/commander/dashboard` showed "Your Session Is Not Valid
For This Data. Some Panels May Be Empty." with a Sign In Again button; the
login page then refused every credential ("completeLogin is not defined").
Mobile was hit first because the hub's SSO lands on `commander.smarter.poker`
directly. Duration: at least several days; nobody paged.

## Root causes (four, stacked)

1. **`completeLogin` did not exist.** `pages/commander/login.js` called it from
   every sign-in path; the function had been removed while `pages/auth/sso.js`
   kept a private copy. Supabase accepted the password, then the page threw.
2. **The derived staff session went stale and nothing healed it.** The
   HMAC-signed `x-staff-session` (7-day TTL then) is invalidated by secret
   rotation (2026-09-01 `COMMANDER_STAFF_SESSION_SECRET`) and was hand-edited
   by the club switcher (which broke its HMAC). Every guarded API 401'd while
   the Supabase session was still valid.
3. **`smarter.poker/commander/*` never ran any JavaScript.** The proxied HTML
   requested `/_next/*` from the hub origin, which 404'd every chunk.
4. **Nothing could see it.** `next lint` (advisory) reported the undefined
   identifier on every build. Client Sentry was not in the bundle at all.
   And the Sentry org quota had been exhausted since 2026-08-24 by Club Arena
   engine loops, so even a wired Sentry would have been 429'd.

## Fixes (all merged, deployed, verified live)

| PR | What |
|---|---|
| commander #94 | shared `staffSession` module; `commanderFetch` 401 self-heal; login/sso restored; cross-origin `?bridge=1`; check-subscription rate limit |
| commander #95 | production `assetPrefix` |
| hub #1290 | `/images/commander/*` rewrite |
| commander #96 | login-bridge law test + client staff-session suite; club switcher server-signed; banner self-heal; mount refresh |
| commander #97 | blocking `no-undef` gate (found 500s on tournament payout/reconciliation, `IsNegative` crash); middleware = PIN only; Sentry client+server actually loaded; `authFlowMonitor`; `/api/health` booleans; production probe + Playwright workflow; runbooks; 23 stray files removed |
| commander #99 | probe config gaps are WARN |
| commander #100 | untrack `node_modules` symlink |
| commander #101 | self-heal uses a refreshed token (provider hook); silent sign-in checks user_id; Remember Me honoured; Sentry ingest check in probe; real alert rule ids |
| commander-shared #55, #56 | all of the above upstreamed + node:test suite |
| club-arena #2869, hub #1292 | stale docs corrected |

## Guards that now exist

- `npm run lint:undef` blocking in CI (`eslint.undef.config.mjs`).
- `tests/unit/loginBridge.law.test.js` (13 pins) + `clientStaffSession.test.js`.
- `login-bridge-probe.yml`: 21-check structural probe + 5-scenario Playwright,
  every 30 min and on merge; self-closing incident issue.
- `/api/health` booleans for DSN + signing secrets.
- Sentry rules 17436063-5 for `commander.auth.*` (blind until the quota
  renews 2026-09-16 or is raised - see `docs/runbooks/sentry-auth-alerts.md`).

## Still open (needs Dan)

- Sentry quota / engine's own Sentry project.
- `PROBE_EMAIL` / `PROBE_PASSWORD` secrets on the commander repo.
