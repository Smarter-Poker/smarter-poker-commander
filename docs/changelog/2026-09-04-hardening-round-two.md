# 2026-09-04 - Hardening round two: page, hop, mobile, pull-request probe, own Sentry project

Built after the first round shipped and the signed-in legs went green with
the real probe credentials. Each item closes a way the 2026-09-03 outage could
still have gone unnoticed or unreproduced.

## A failing probe now reaches a phone (World Hub PR: fix/openclaw-critical-job-paging)

`scripts/openclaw-cron-dispatcher.py` gained `CRITICAL_JOBS`: a path -> threshold
map. Two consecutive non-200 responses from the commander login-bridge probe
(timeouts, exceptions and a 401 from `CRON_SECRET` drift all count) send one
SMS through the dispatcher's existing `_alert()` path (de-duplicated, cooldown,
state persisted across restarts); one recovery SMS when it is 200 again.
Before this the failure produced a journal line, a GitHub issue and a Sentry
event that the exhausted quota drops. `scripts/ci/test-openclaw-critical-jobs.py`
drives six scenarios; `__tests__/openclaw-critical-jobs.test.mjs` runs it in
CHECK 8.

## The browser leg walks the hop users take, in three browsers

`tests/e2e/login-bridge.spec.ts`: a hub session (password grant over the API,
stored as `smarter-poker-auth` on smarter.poker only), then `/commander/login`
on the commander origin, press "Continue As Smarter.Poker", and assert the
dashboard on the commander origin with a server-signed staff session, the
platform session copied across, and NO password grant on the wire.
`playwright.config.ts` runs every spec in Desktop Chrome, Desktop Safari
(WebKit) and iPhone 13 (mobile Safari). 15 signed-out cases pass locally in
all three; the 6 signed-in cases run in the workflow with the repo secrets.

## Every pull request is probed before it can merge

`ci.yml`'s required `build` job now `next start`s the build it just made (no
secrets) and runs the structural leg in local mode (`PROBE_LOCAL=1`,
`opts.local` in `src/lib/probe/loginBridgeProbe.mjs`). Local mode skips the
hub-origin rows and the Sentry ingest row, turns the secrets-present rows
into warnings, checks a malformed token gets a 400 (the lookup needs a
service-role key), expects root-relative chunks (no assetPrefix off
production) - and keeps the row that names the outage. Verified negatively:
appending `completeLogin(1)` to the built login chunk turns the step red.
Vercel preview URLs were the obvious target and were rejected: this project
SSO-protects previews (`ssoProtection: all_except_custom_domains`), so a
runner cannot reach them without the automation-bypass secret.

## Commander has its own Sentry project

`club-commander` (id 4512029155393536). `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`
on the Vercel project now point at it; the five alert rules (17436602-17436606)
live there; the old rules in the World Hub project are deleted once this deploy
is live. The org quota is unchanged (exhausted until 2026-09-16); the separate
project keeps Commander's rules and rate limits from being drowned by hub
noise and makes "0 issues" mean "0 Commander issues".

## Law pins

`tests/unit/loginBridge.law.test.js` pins 17 (hop spec + three browsers) and 18
(pull-request probe in the required job, local mode still names the outage).
