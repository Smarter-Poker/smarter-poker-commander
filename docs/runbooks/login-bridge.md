# Runbook: the Smarter.Poker -> Club Commander login bridge

**Owner:** whoever is on the `login-bridge-probe` issue. **Last incident:** 2026-09-03.

## How a sign-in works (read this once)

```
smarter.poker (hub)                              commander.smarter.poker
-------------------                              -----------------------
Supabase session in localStorage                 Supabase session in localStorage
 key 'smarter-poker-auth'                         key 'smarter-poker-auth'  (separate origin!)
        |                                                 ^
        | click Commander orb                             |
        v                                                 |
POST /api/auth/commander-sso  --one-time token-->  /auth/sso?token&uid
 (Bearer = hub access token)                     POST /api/auth/sso-exchange -> magic-link OTP
                                                 supabase.auth.verifyOtp()  -> commander session
                                                 completeCommanderLogin()   (staffSession.js)
                                                   POST /api/commander/check-subscription (Bearer)
                                                   <- { subscription, staff_session (HMAC-signed) }
                                                   localStorage.commander_staff = staff_session
                                                 -> /commander/dashboard
```

Every guarded API needs **two** things: the Supabase Bearer token (`Authorization`)
and the signed staff session (`x-staff-session`). The staff session is derived,
has a 7-day TTL, and is invalidated by a signing-secret change. When it goes
stale, `commanderFetch` re-mints it from the live Supabase session and retries
**before** anything is shown. Only when the Supabase session itself is gone
does the user see "Your Session Is Not Valid" / "Sign In Again".

`smarter.poker/commander/*` is a Vercel rewrite to the commander app. Its HTML
must load `/_next/*` from `commander.smarter.poker` (`assetPrefix` in
`next.config.js`), or every chunk 404s on the hub origin and the page spins
forever.

## The guards (what fails, and where)

| Layer | What | Where |
|---|---|---|
| Source | `no-undef` blocking lint | `npm run lint:undef`, CI step "Undefined identifiers (blocking)" |
| Source | Login-bridge law (static pins) | `tests/unit/loginBridge.law.test.js` |
| Behaviour | staffSession suite | `tests/unit/clientStaffSession.test.js` |
| Production | Structural + signed-in probe, every 30 min | `.github/workflows/login-bridge-probe.yml` -> `scripts/probe-login-bridge.mjs` |
| Production | Real-browser E2E, every 30 min | same workflow, job `e2e` -> `tests/e2e/login-bridge.spec.ts` |
| Runtime | Sentry: `commander.auth.*` messages | `src/lib/authFlowMonitor.js`, alert rules in `sentry-auth-alerts.md` |

The probe files ONE self-updating issue labelled `login-bridge-probe` and closes
it when green. If that issue is open, sign-in is (or was) broken in production.

## Triage, fastest first

1. **Open the probe issue.** The table names the exact check. Most-likely rows:
   - `all N chunks ... load as JavaScript` on the **hub** URL -> `assetPrefix`
     lost or the hub rewrite changed. Check `next.config.js`, hub `vercel.json`.
   - `login chunk has no free completeLogin( call` -> someone re-broke
     login.js. The law test should have caught it; check whether CI was skipped.
   - `guarded API rejects an UNSIGNED staff session` failing -> the HMAC gate
     in `src/lib/commander/auth.js` was weakened. Security issue; fix first.
   - `signing secret configured` / `service-role key configured` -> Vercel env
     vars removed. See `staff-session-secret-rotation.md`.
   - `client Sentry DSN configured` -> `NEXT_PUBLIC_SENTRY_DSN` missing in
     Vercel production. Browser errors are invisible until it is set.
2. **Run it yourself:** `node scripts/probe-login-bridge.mjs` (add
   `PROBE_EMAIL`/`PROBE_PASSWORD` for the signed-in leg). It prints a table.
3. **Reproduce in a browser:** `CI=1 PLAYWRIGHT_BASE_URL=https://commander.smarter.poker npx playwright test tests/e2e/login-bridge.spec.ts`.
4. **Fix forward.** Never `--no-verify`, never weaken a pin. If a pin is wrong,
   change the code AND the pin in the same PR and say why.

## Secrets this depends on (names only)

| Secret | Where | Used by |
|---|---|---|
| `COMMANDER_STAFF_SESSION_SECRET` (fallbacks: `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) | Vercel: smarter-poker-commander | signing + verifying `x-staff-session` |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel: smarter-poker-commander, hub-vanguard | check-subscription, sso-exchange, commander-sso |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` | Vercel: smarter-poker-commander | error capture |
| `PROBE_EMAIL`, `PROBE_PASSWORD` | GitHub repo secrets | signed-in probe leg + Playwright signed-in spec (a Commander owner test account) |

Until `PROBE_EMAIL`/`PROBE_PASSWORD` exist, the probe and E2E run their
signed-out legs only and say so in the log.
