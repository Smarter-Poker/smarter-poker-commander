# Club Commander — Full Line-by-Line Audit

**Date:** 2026-07-25 / 26  ·  **Scope:** every Club Commander page, subpage, API route, shared component and database dependency, from account signup through daily floor operations.

**Shipped and verified live:** commander `main` @ `b91da844` · World Hub `main` (served by `hub-vanguard`) · 4 database migrations applied to `kuklfnapbkmacvwxktbh`.

**Completeness:** 161 of 161 changed files confirmed byte-identical on `main` by git blob-SHA comparison — 134/134 commander, 27/27 World Hub. Nothing withheld.

---

## What was audited

Club Commander spans two repositories and one shared package. The staff application lives in `smarter-poker-commander` (105 pages, 251 API routes) and is served at `commander.smarter.poker`, proxied to `smarter.poker/commander/*` by World Hub rewrites. The player-facing half lives in World Hub under `pages/hub/commander` (about 40 pages) and reaches the staff API through `/api/commander/*`. Both consume `@smarter-poker/commander-shared`.

Seven parallel auditors read every file in their slice line by line — signup and auth, live floor operations, tournaments, members and money, displays and communications, the player experience, and the home-games API plus shared package internals. Every database query was checked against the live production schema (699 tables) rather than against assumptions, and every cross-origin fetch was traced to the handler it actually reaches.

## The headline findings

The most serious defect was that staff identity was **forgeable**. `verifyStaffSession` trusted the raw, unsigned `x-staff-session` JSON header sent by the client. Anyone who learned a venue id and a user id — both of which leak through ordinary endpoints — could mint an owner session and gain full manager access to any venue. Sessions are now HMAC-signed server-side and rejected unless the signature verifies.

Close behind, three staff-management endpoints had their authentication **deleted** behind a comment claiming middleware covered them. It did not: `middleware.ts` only gated `/api/admin/*`, never `/api/staff/*`. An unauthenticated caller could create an owner-role staff member with a chosen PIN and then log in as that owner — complete venue takeover. Authentication is restored on all three, with venue scoping and a self-deactivation guard.

The admin PIN gate was itself **fully bypassable**. Middleware runs before Next.js rewrites, so it saw `/api/commander/admin/...` — a path its regex didn't match — while the rewrite quietly delivered the request to the admin handler. The admin UI used exactly that prefixed path, proving the gate had never protected the API. The regex now covers both forms. Separately, the PIN feature could never have worked at all: both `set_commander_admin_pin` and `verify_commander_admin_pin` were called in code but did not exist in the database, so every PIN entry returned a 500.

That pattern repeated. Eight RPC functions and one whole table were referenced by shipping code but absent from production: the escrow family (`commander_escrow_transactions`) failed on every call, comp issuance and redemption both 500'd, home-game completion never updated attendance, hand counts silently lost increments under concurrency, and error-rate health metrics were never recorded. All are now created and verified present.

Several pages were simply dead on arrival. `pages/api/games/must-move-status.js` and two other files had automatic-semicolon-insertion bugs — a query builder followed by a parenthesized expression parsed as a function call — throwing 500s whenever real data was present. `profile/stats.js` and `squads/my.js` called `.limit(100)` on a JavaScript number and array respectively, crashing for essentially every user. The TD payouts page referenced toast state declared only in a child component, white-screening on render. The player Responsible Gaming page referenced an undeclared `exclusion` state and crashed on mount.

A large class of player-facing features was gated behind staff-only guards, making them impossible to use: service requests, profile edits, league joins, table ratings, notification mark-read, tournament self-registration and comp redemption all required an `x-staff-session` no player could ever have. Each now authenticates the player's own JWT and is scoped to that player's own rows.

There were also real privacy leaks. `GET /api/commander/members` was unauthenticated and returned full member PII including date of birth and government ID numbers for any venue id. The player "My History" page fetched a venue-wide session list and presented other players' sessions as the user's own. Hand history returned opponents' hole cards through a fallback that handed out the first seat's cards to anyone. Public TV display endpoints exposed full waitlist names under guessable device ids. All are now authenticated, scoped, or redacted.

Finally, a set of drift bugs came from code and schema disagreeing. Tournaments read `rebuy_cost`, `addon_cost` and `clock_state` — columns that do not exist — so rebuy and add-on money was never recorded and prize pools displayed short. `game_type` was stored uppercase by the waitlist and lowercase by games, so waitlist entries never linked to their game, live waitlist counts always read zero, and desk seating deleted the entry without creating a seat. Casing is now normalized in both the code and the existing data.

## Fix inventory

| Area | Files changed | Representative fixes |
|---|---|---|
| Auth & session core | 6 | HMAC-signed staff sessions, JWT/staff cross-check, `user_id`/`linked_user_id` reconciliation, unified auth storage key |
| Signup & billing | 6 | Authenticated existing-account linking, Stripe guarded init, checkout→venue webhook linkage, 14-day trial unified |
| Admin console | 7 | PIN gate regex, PIN enrollment flow, correct tables and response shapes, invalid DOM nesting removed |
| Live floor ops | 18 | ASI crashes, seat-occupancy races, `game_type` casing, public self-check-in endpoint, venue scoping |
| Tournaments | 29 | Real schema columns, level-advance fencing, payout/ICM correctness, late-reg cutoff, double-seat guard |
| Members & money | 18 | Comp RPCs, exclusion schema alignment, revenue from real source, CSV injection guard, tax-event scoping |
| Displays & comms | 25 | Broadcast announcements, device registration lockdown, name redaction, timezone-correct scheduling |
| Player experience (World Hub) | 27 | Player-JWT auth paths, real QR code, response-shape fixes, squad invite flow, dead store removed |
| Cross-origin wiring | 2 | Server-side forwarding of `/api/promo`, `/api/social` and friends; `/hub/*` redirects to the player origin |
| Database | 4 migrations | `commander_admin_pins`, `commander_escrow_transactions`, 6 missing RPCs, `players_involved`, `amount_paid`, casing normalization |

**161 files changed, ~3,900 lines added.** Every changed file passed a syntax check before shipping.

## Verification performed

Production health reports `b91da844`, matching the final merge commit exactly, on a fresh uncached read. The previously-bypassable `/api/commander/admin/leads` now returns `401`, confirming the PIN gate fix is live. All 134 changed commander files and all 27 World Hub files were confirmed byte-identical on `main` by comparing git blob SHAs, in an independent pass after the final merge. Both Vercel production deployments report `READY`. All 13 database objects (8 RPCs, 2 tables, 2 columns) were re-queried and confirmed present, with zero uppercase `game_type` rows remaining.

The shared package `@smarter-poker/commander-shared` was **not modified** by this audit — confirmed by diff — so no unpublished package changes are stranded.

## Follow-up phase (2026-07-26): the five remaining defects

An earlier draft of this record claimed all five required a shared-package release. That was wrong, and the correction matters: `apiRateLimit`, `icm-utils` and `useClubBranding` are all imported by their consumers through **local paths** in this repo (`src/lib/...`), where the files were only one-line re-export shims. Replacing a shim with a real implementation therefore fixes the behaviour with no import changes and no package release — the same local-override pattern already used by `src/lib/commander/auth.js`. Three of the five were closed that way.

**Rate limiter — fixed.** `getIdentifier` keyed on `authorization.slice(7, 39)`, described in a comment as "the first 32 characters of the JWT". Every Supabase HS256 token opens with the identical base64url header, so that slice was a constant and every authenticated user shared a single bucket per endpoint: one busy client could 429 a whole venue. Identity now comes from the JWT `sub` claim, with a token hash as fallback and a separate bucket for PIN terminals keyed on the staff row.

**ICM — fixed, and it was worse than described.** The old code handled 1st, 2nd and partially 3rd exactly, then fell back to `pFirst * (stack / remainingTotal) * (1 / position)`, which is not a probability distribution. Measured against the real prize pool it under-allocated by 10.0% on a 3-handed $10,000 pool, 11.6% on a 5-handed $24,000 pool, and 21.6% on a 9-handed $25,200 pool — over five thousand dollars of equity simply absent from the numbers a tournament director would use to negotiate a deal. It is now a true Malmuth-Harville subset dynamic program, exact to 18 players (105 ms at that ceiling) with an explicitly normalised approximation above it, and a cent-level reconciliation so the rounded figures total the pool precisely. Seventeen assertions cover sum-to-pool, the known two-player result, ICM-versus-chip-chop compression direction, equal-stack symmetry, monotonicity, large fields, and degenerate inputs.

**useClubBranding — fixed.** `refresh()` read `staff.venue_name` while `staff` was declared in a different effect, so it threw a swallowed ReferenceError on every cache-cold fetch. The `localStorage` write immediately below it never ran, meaning the five-minute TTL cache never populated and every mount re-hit `/api/commander/settings`. The staff blob is now read in scope.

**FloorCallAlert — fixed upstream, awaiting publish.** This one could not be closed from a consuming repo. `CommanderLayout.jsx` imports it as `'./FloorCallAlert'`, a relative specifier *inside* the package, so a local override cannot intercept it — and CommanderLayout wraps every staff page. Its header has always advertised a 5-second polling fallback while `pollInterval` was declared and never assigned, meaning realtime was the only live path. A safety poll now runs alongside realtime, deliberately at 20 s rather than 5 s: realtime already delivers in about a second, so the poll exists purely to catch a dead channel without putting every Commander screen on a five-second query loop.

**A further defect surfaced while verifying that one, and it was more serious.** `useCommanderSync` — the singleton realtime manager behind **75 Commander pages** — retried a failed Supabase channel at most five times (3s, 6s, 9s, 12s, 15s) and then **gave up permanently**, because `entry.reconnects` only reset on a successful `SUBSCRIBED`. Any outage longer than roughly 45 seconds silently killed realtime for that venue in that tab: waitlist, tables, games, tournaments and floor calls all stopped updating, with nothing surfaced to the operator, until someone manually reloaded. On floor tablets left open for a whole shift this is a real operational hazard, and it is the root cause that made the missing FloorCallAlert poll dangerous. Retries now continue indefinitely with exponential backoff capped at 60 s, `CLOSED` is treated as retryable, and a new `channelManager.ensureHealthy()` fires on tab focus and network recovery so an operator returning to a tablet gets live data at once.

Both fixes are merged to `commander-shared` `main` as **v0.1.2**. They were deliberately *not* forked into the Commander repo as local overrides: doing so would load a second copy of the module, and since `channelManager` is a module-level singleton, every venue would end up with two Supabase channels per tab instead of one. Correctness here is worth the release step. Both consumers pin `^0.1.1`, which admits `0.1.2`, so a single `npm publish` propagates the fix on their next build with no consumer changes. One caveat for whoever publishes: the repo manifest read `0.1.0` while the published artifact was `0.1.1` and carried `publishConfig.access: "public"` where the repo says `"restricted"`. The `src/` trees were byte-identical, so only the manifest had drifted; `access` was left as the repo had it rather than silently changing publish visibility.

**premiumFeatureGate — no action required.** Its dead session probe is real, but the module has no consumers in either repository or inside the shared package itself. Nothing calls `checkFeatureAccess`, so the 500 ms penalty never executes. Converting the shim into a forked local copy would add maintenance cost for code nobody runs; it is better left until something actually wires it up.

## Repository cleanup

Completed. `audit-final-10` — which carried a corrupted `waitlist/desk.js` from a failed transport attempt — was deleted from `origin`, along with the unused `audit-fixes-all` and `commander-audit-all` integration branches. The correct `desk.js` reached `main` via `audit-final-12`. Remaining merged branches are harmless and may be deleted at will.
