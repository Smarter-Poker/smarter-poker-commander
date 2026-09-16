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
- src/lib/apiErrorHandler.js
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
- [x] Phase 3.3: Shared libs duplicated into the new repo (no @smarter-poker/commander-shared package yet - duplication-first approach)
- [x] Phase 3.4: All 246 API files copied with import paths fixed
- [x] Phase 3.5: All 105 frontend pages copied
- [ ] Vercel project provisioning (needs Dan)
- [ ] DNS for commander.smarter.poker (needs Dan)
- [ ] Vercel rewrites in World Hub vercel.json (deferred - only land after commander origin is reachable)
- [ ] World Hub deletion of duplicated commander files (Phase 3.7 - deferred until commander is live + stable)

## What's NOT done yet

- World Hub still serves all 246 commander API routes + 105 pages.
  Migration is "shadow copy ready, awaiting deployment".
- Vercel project for `commander.smarter.poker` not yet created - that's
  a Vercel-dashboard action.
- DNS for `commander.smarter.poker` not yet configured.
- Once Vercel + DNS are live, World Hub vercel.json gets the rewrite
  rules added in a single PR (atomic cutover per slice).


## 2026-08-19: Tournament Director Parity Overhaul (Cowork Session)

Deep line-by-line pass over all tournament code, targeting functional parity
with PokerAtlas TableCaptain tournament director + tournament building/display.

Database (applied to production via Supabase MCP, migration file committed in
World Hub repo as supabase/migrations/20260819120000_tournament_director_parity_constraints_and_clock_rpc.sql):
- commander_tournament_entries.status CHECK now allows 'alternate' and 'cashed'
  (code emitted both; the DB rejected them).
- commander_tournaments.tournament_type CHECK now allows 'pko' and 'deepstack'
  (the archived 20260215 pko migration had never been applied to production).
- New RPC commander_clock_write(): atomic jsonb_set of settings.clock_state plus
  optional status/current_level/actual_start/ended_at. Removes the lost-update
  race between two TD tablets doing read-modify-write of the whole settings blob.

API fixes (pages/api/tournaments/**): atomic clock writes via the new RPC
(clock, floor-view, hand-for-hand, message, final-table); floor-view GET now
staff-gated (was public, leaked names/phones/chips); duration_minutes accepted
everywhere; break-aware level numbering (breaks share the structure array, index
is not the level number); prize pool = max(collected, guarantee) with overlay
exposed; payout generator + exact-sum rounding; eliminate race guards +
bounty-after-win fix + winner payout matches structure; register spending-limit
fee fix; reports payment/cashier attribution restored; auto-break fixes
(rebuy_end_level, commander_tables release, no more placeholder Supabase creds).

UI fixes (staff td/*, tournaments/*, flat tournament pages, vendor shared
components): break-aware level display everywhere, duration_minutes fallbacks,
from_level concurrency on auto-advance with 409 handling, overlay indicators,
Tournament Director nav entry in CommanderLayout, prev_level action name fix.

Style (binding rule from Dan): every user-visible string Title Cased (First
Letter Of Every Word); em dashes removed repo-wide (comments included); two
data-matching regexes preserved via unicode-escape (\u2014) character classes (comps.js, CommanderLayout).

World Hub side (committed in the World Hub repo): catch-all proxy
pages/api/commander/tournaments/[[...path]].js so player pages work again,
corrected ICM synced into vendor, break-aware player pages, style sweep.
