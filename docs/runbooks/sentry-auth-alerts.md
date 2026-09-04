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

## Alert rules (created 2026-09-03/04 - IDs are real, links are the Sentry UI)

Project: `javascript-nextjsmarter-poker-world-hubs` (the Commander DSN points at
the World Hub's Sentry project; all rules live there). Org `smarter-software-inc`.

| Rule id | Name | Trigger | Filter |
|---|---|---|---|
| 17436063 | Commander login ReferenceError (page) | >= 1 event in 5 min | message contains `commander.auth.reference_error` |
| 17436064 | Commander login completion failing (page) | >= 5 events in 15 min | message contains `commander.auth.login_failed` |
| 17436065 | Commander unhealable 401 spike (warn) | >= 20 events in 15 min | message contains `commander.auth.unauthorized` |
| 17435218 | Auth Failure Spike | >= 10 events in 5 min | message contains `commander.auth` OR `auth` (was unfiltered - fired on any noisy issue) |
| 17435219 | Session Token Validation Error | first seen | message contains `jwt` |
| 17435220 | Repeated Probe Auth Failure | >= 3 in 15 min | message contains `probe` |
| 17435221 | New Unhandled Auth Error | first seen | message contains `auth` |

All notify the org member (fallthrough: active members). Rule URLs:
`https://smarter-software-inc.sentry.io/alerts/rules/javascript-nextjsmarter-poker-world-hubs/<id>/details/`

## THE QUOTA - read this before trusting any Sentry alert

Verified 2026-09-04 via the stats API: the org's error quota was exhausted on
**2026-08-24** and has accepted **zero** error events since - 11 days of
`429 error_usage_exceeded` (7,364 rejected + ~190k client-side backoff discards
in one 24h window). Every alert rule above, and every other Sentry alert on
the estate, was blind the whole time. The dashboards showed "0 issues", which
looked like health.

What burned it: the Club Arena engine (Hetzner) reporting into the SAME
project in loops - `RakebackSettler.period_recompute` (22k), `TableFSM
invalidTransition` (45k across three fingerprints), `logHandHistory
insert_failed` (17k), `GameServer.table_lease_lost` (15k) - ~100k accepted
events on 2026-08-22 alone. Quota renews **2026-09-16**.

The login-bridge probe now posts one tiny event per run and reports
`Sentry accepts events (alert rules can fire)` as WARN on 429, so this cannot
go unnoticed again. Two things only Dan can decide:

1. Raise the plan / on-demand cap so the estate is not blind until the 16th.
2. Stop the engine loops from eating the quota after renewal: give the engine
   its own Sentry project (its own quota) and set `sampleRate` / SDK-side
   dedupe on the repeating fingerprints. Until then, one bad night on the
   engine silences Commander's auth alerts.

## Verifying capture works

Browser devtools on `https://commander.smarter.poker/commander/login`:
`window.dispatchEvent(new CustomEvent('commander:unauthorized', { detail: { url: 'manual-test' } }))`
should produce a `commander.auth.unauthorized` message in Sentry within a minute
(production only; init is gated to `NODE_ENV === 'production'`).
