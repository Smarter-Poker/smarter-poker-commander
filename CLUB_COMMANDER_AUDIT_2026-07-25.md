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

## Known issues found but deliberately NOT fixed

These are real defects identified during the audit and consciously left alone, because each needs either a package release or design input rather than an in-place edit. None of them regressed; all predate this work.

The ICM implementation in `commander-shared/src/lib/commander/icm-utils.js` uses a `1/position` heuristic beyond third place, so deal equities do not sum exactly to the prize pool; a proper Malmuth-Harville recursion is the correct fix. The rate limiter in `src/lib/apiRateLimit.js` keys on the first 32 characters of the JWT, which is the identical algorithm header for every Supabase token, so all authenticated users share one bucket per endpoint. Three further shared-package bugs remain: `useClubBranding.js` references an undefined `staff` variable in `refresh()`, `FloorCallAlert.js` documents a 5-second polling fallback that was never implemented, and `premiumFeatureGate.js` runs a dead session probe that costs every gated check a guaranteed 500 ms delay. Fixing these requires publishing a new version of the shared package and bumping both consumers.

## Repository cleanup needed

The audit used short-lived branches, and this MCP has no branch-deletion capability, so three are left behind for manual removal. `audit-final-10` is the one that matters: it contains a **corrupted** copy of `waitlist/desk.js` from a failed transport attempt and must never be merged — the correct version of that file is on `main` via `audit-final-12`. `audit-fixes-all` and `commander-audit-all` are empty branches created as integration points and never used. The merged `audit-fixes-1..9`, `audit-final-1..9`, `audit-final-11..12` and `commander-audit-1..3` branches are safe to delete at will.
