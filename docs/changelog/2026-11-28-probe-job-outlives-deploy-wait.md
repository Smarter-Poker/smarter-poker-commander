# Login bridge probe job outlives its own deploy wait (2026-11-28)

On a push to main, the probe job waits for `/api/health` to report the
merge commit, bounded at 60 tries (10 s sleep + up to 15 s curl, so up to
~25 minutes in the worst case, ~10 minutes typically). When Vercel skips the
build (docs, tests or workflow-only merges, by `vercel.json`), the version
never moves and the wait is meant to run out and then "probe what is live".
The job's `timeout-minutes: 10` cancelled it inside the wait instead: the
probe never ran and the whole run ended `cancelled` (run 46126200298, merge
of #171, 2026-11-28 2:41 AM Central; the e2e job in the same run passed).

`timeout-minutes` 10 -> 30 on the probe job and 40 -> 50 on the e2e job
(worst-case wait plus each job's own work). Pinned in
`tests/unit/staffHeadersCensus.law.test.js`: both job limits must exceed the
worst-case wait plus their own work.
