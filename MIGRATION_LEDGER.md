# Commander Migration Ledger

Phase 3.2-3.4 initial migration completed 2026-04-25.

## Files moved (totals)

| Source path (in monolith) | Dest path (here) | File count |
|---|---|---|
| pages/api/commander/* | pages/api/* | 246 |
| pages/commander/* | pages/commander/* | 105 |
| src/lib/commander/* | src/lib/commander/* | 17 |
| src/components/commander/* | src/components/commander/* | 52 |

## Supporting libs duplicated (per design doc)

These are shared utilities; commander needs its own copy for repo independence:
- src/lib/sentryWrap.js
- src/lib/supabase.js
- src/lib/supabaseServerClient.js
- src/lib/serverAuth.js
- src/lib/apiRateLimit.js
- src/lib/authUtils.js
- src/lib/gates/ (2 files)

## Import path fixup

All 246 API files had their `../../../...src/lib/...` imports rewritten
to drop one level (commander/ removed from path). One-pass regex applied
on initial copy.

## Status

- [x] Phase 3.2: Repo scaffold (next.config.js, package.json, tsconfig, middleware.ts, CI workflow)
- [x] Phase 3.3: Shared libs duplicated into the new repo (no @smarter-poker/commander-shared package yet — duplication-first approach)
- [x] Phase 3.4: All 246 API files copied with import paths fixed
- [x] Phase 3.5: All 105 frontend pages copied
- [ ] Vercel project provisioning (needs Dan)
- [ ] DNS for commander.smarter.poker (needs Dan)
- [ ] Vercel rewrites in World Hub vercel.json (deferred — only land after commander origin is reachable)
- [ ] World Hub deletion of duplicated commander files (Phase 3.7 — deferred until commander is live + stable)

## What's NOT done yet

- World Hub still serves all 246 commander API routes + 105 pages.
  Migration is "shadow copy ready, awaiting deployment".
- Vercel project for `commander.smarter.poker` not yet created — that's
  a Vercel-dashboard action.
- DNS for `commander.smarter.poker` not yet configured.
- Once Vercel + DNS are live, World Hub vercel.json gets the rewrite
  rules added in a single PR (atomic cutover per slice).

