# Runbook: Sentry alerts for the auth flow

## Why this file exists

On 2026-09-03 `ReferenceError: completeLogin is not defined` fired on every
Commander login for days and nothing paged, because **client-side Sentry was
not running at all**: `sentry.client.config.js` is only picked up by
`withSentryConfig`, which this repo does not use, and Next 14 does not load
`instrumentation-client`. `pages/_app.js` now imports the client config
directly and `instrumentation.js` loads the server/edge configs. Whether a DSN
is configured is visible at `/api/health` -> `observability.sentry_client_dsn`
and asserted by the login-bridge probe.

## Events the app emits (stable names, stable tags)

`src/lib/authFlowMonitor.js` captures these as Sentry **messages** with tags
`app=commander`, `flow=login|sso|session`:

| Message | Level | Meaning |
|---|---|---|
| `commander.auth.reference_error` | fatal | A `ReferenceError` on `/commander/login` or `/auth/sso`. The 2026-09-03 class. Should be 0 forever. |
| `commander.auth.login_failed` | error | Supabase accepted the user but Commander completion failed (check-subscription, SSO exchange). Includes `error` and `status` extras. |
| `commander.auth.unauthorized` | warning | A 401 that `refreshStaffSession()` could NOT heal - the platform session is gone or the account has no subscription. A steady trickle is normal; a spike is an incident. |

API-route exceptions still go through `reportApiError()` (tags `route`, `method`).

## Alert rules to create (Sentry -> Alerts -> Create Alert -> Issues)

Project: the Commander Sentry project (tag `app:commander`).

1. **Login ReferenceError** - `message:commander.auth.reference_error`,
   "number of events >= 1 in 5 minutes" -> **page** (PagerDuty/SMS/whatever the
   estate uses). Nothing legitimate produces this.
2. **Login completion failing** - `message:commander.auth.login_failed`,
   ">= 5 events in 10 minutes" -> page. A single event is one user with no
   subscription; five in ten minutes is the endpoint.
3. **Unhealable 401 spike** - `message:commander.auth.unauthorized`,
   ">= 20 events in 10 minutes" -> warn (Slack). Usually the signing secret or
   the service-role key went missing; check `/api/health` `auth.*` booleans.
4. **API 500 spike** - `level:error tag:route:/api/*`, ">= 25 in 10 minutes" -> warn.

Sentry alert rules live in Sentry, not in this repo; whoever creates them
should paste the rule links below so the next person can find them.

- Rule 1: _(link)_
- Rule 2: _(link)_
- Rule 3: _(link)_
- Rule 4: _(link)_

## Verifying capture works

Browser devtools on `https://commander.smarter.poker/commander/login`:
`window.dispatchEvent(new CustomEvent('commander:unauthorized', { detail: { url: 'manual-test' } }))`
should produce a `commander.auth.unauthorized` message in Sentry within a minute
(production only; init is gated to `NODE_ENV === 'production'`).
