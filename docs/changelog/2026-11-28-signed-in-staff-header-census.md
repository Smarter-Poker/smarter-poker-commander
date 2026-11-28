# Signed-in live proof: every staff page wears its #SmarterDesign header (2026-11-28)

Backlog item 3 of the Club Commander #SmarterDesign programme. PR #166 gave
every staff page an image header with one painted "?"; it was only verified
signed out, locally, with a fake staff session. Nothing had opened the real
pages signed in, in production.

## What runs

`tests/e2e/staff-headers.spec.ts`, in the existing e2e job of
`.github/workflows/login-bridge-probe.yml` (no new workflow, no new schedule;
it runs on that workflow's existing 30-minute cron, on `workflow_dispatch`,
and on merges touching the spec, the header registry or the workflow):

1. Password grant for the probe account (`PROBE_EMAIL` / `PROBE_PASSWORD`,
   the owner test account the bridge probe already uses), session handed to
   the commander origin as supabase-js stores it, `/commander/login` mints
   the signed staff session silently and lands on the dashboard.
2. Every route in `src/components/commander/shared/pageHeaders.js` except
   PIN-gated ones (`SENSITIVE_ROUTES`, read from the shared auth module's
   source so the list has one owner, and `/commander/admin/*`, middleware's
   admin PIN) and `next.config.js` redirects. Dynamic routes use a real
   tournament / member id of the probe venue, or are skipped with an
   annotation when the venue has none; ids are never invented.
3. On each: one visible `[data-page-image-header]`, exactly one
   `[data-page-help]`, no "Your Session Is Not Valid" banner, and a
   full-page screenshot to `test-results/staff-headers/`, uploaded as the
   `staff-header-screenshots` artifact (14 days).

Page loads only; nothing is clicked or written. One test with soft
assertions per route, so a single run reports every failing page; no retries
(the census would re-run in full). Job timeout 15 -> 40 minutes.

Without the secrets the step prints a `::notice::` and a step-summary line
saying the census did not run, and the spec itself skips with the same
reason. It never reports a skipped census as a pass.

## Verified locally

Against a local production build with a fake owner session
(`STAFF_HEADERS_FAKE_SESSION=1`, documented in the spec header): 53 routes
visited, all with the header and one "?", 20 excluded (PIN / admin), 13
dynamic routes skipped (no data in fake mode), 44 s. Without credentials:
1 skipped.

## Regression protection

`tests/unit/staffHeadersCensus.law.test.js` (vitest, in `npm test`): the
workflow runs the spec with the probe secrets against production, it lives
only in this workflow, there is still exactly one cron, the step is not
`continue-on-error`, a missing secret is announced, the screenshots are
uploaded, and the spec asserts the header, exactly one "?", reads
`SENSITIVE_ROUTES` and the redirects, and requires more than 40 routes.
