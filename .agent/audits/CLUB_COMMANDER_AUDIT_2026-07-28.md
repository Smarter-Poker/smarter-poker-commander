# Club Commander — Deep Audit, Day 4

**Date:** 2026-07-28 · **Scope:** `smarter-poker-commander`, `Smarter-Poker-World-Hub`, Supabase project `kuklfnapbkmacvwxktbh`

This record covers the fourth day of the audit. It is deliberately explicit about what was **not** fixed, because the largest finding of the day is an inventory rather than a patch.

---

## The headline: a public roster of who is sitting at which table

`/api/social/pages/games` has an unauthenticated `GET` that queries with the **service role**, so RLS does not apply. When a social page carries a `linked_venue_id` it bridged straight into Club Commander and returned every seated player's **full legal name**, taken from the venue's member records rather than from anything the player typed. Anyone could read a club's entire floor without logging in.

In a card room this is a safety problem as much as a privacy one: players leave carrying cash.

Names — and dealer names — are now redacted server-side to `First L.`, matching the format the public TV display endpoint has used since 2026-07-25, so both public surfaces agree. Dealers are staff rather than players, but the exposure is the same shape: sampling that endpoint over a few days yields a named employee's shift pattern and workplace. Employment is not consent to be publicly tracked.

Verified against the deployed endpoint rather than the source: production returns `Penelope B.`, `Zoey J.`, `Eli P.`, `Jordan K.`

The self-entered `club_game_seats` path is deliberately untouched. Those names are typed by the player into the social page to reserve a seat, and are consented for that surface.

## The same tab had been dead for five months

While fixing the leak it became clear the feature was not working at all: the Games tab read `No Live Games Right Now` while the club's floor had 19 tables running.

The bridge queried `commander_games` filtered on `status IN ('running','waiting')`. Across that entire table, every venue, the only statuses present are `closed` and `breaking`, and the most recent `started_at` anywhere is **2026-02-28**. It is a legacy model the product moved off; the live floor is `commander_tables` + `commander_table_sessions`. The bridge was never repointed.

It now returns 15 cash games and 73 seated players. Chasing that surfaced a third defect: `dealer_name` was `null` on every game despite 42 open rotations existing. The query used a PostgREST embed, `commander_dealers:dealer_id (id, name)`, and **there is no foreign key** from `dealer_id` to that table — so PostgREST rejected the entire request and returned `null`, which the call site coerced away with `|| []`. Dealer names had almost certainly never appeared here.

## Unauthenticated dealer endpoints, and a venue scope that wasn't

`dealer/session-action` and `dealer/player-unseat` accept anonymous POSTs with **no credential of any kind**, and neither was scoped by venue. Table and seat are small integers — roughly 180 realistic combinations — so the floor could be enumerated, live billing timers paused, players reseated, and full player names read back. `player-unseat` also credits minutes back and writes comp rows, making seat/unseat cycling a comp-farming primitive.

Whether these should require a staff session is a **product question**: dealer tablets at a table have no human login. That question is recorded below, unanswered.

What was unambiguous was the venue scoping, and the first attempt at it was wrong in an instructive way. Making `venue_id` mandatory broke three callers that had never sent it — player removal returned 400 on every screen for about ten minutes. The deeper error was conceptual: **requiring `venue_id` buys no security on an unauthenticated route**, because an attacker supplies whatever venue they like. The genuine defect is the *accidental* cross-venue match — table numbers are not globally unique, so two clubs both have a table 1 seat 1, and an unscoped lookup silently acted on whichever row the planner returned first.

The shipped fix is ambiguity-aware: `venue_id` is optional, scopes the lookup when supplied, and when absent the lookup must resolve to exactly one row or it refuses with 409. Strictly safer than the original, which picked a venue silently.

## Authentication that failed open

Seventeen checks across both repos treated a **missing** credential as permission to proceed. Two shapes: the explicit `if (!SECRET) return true`, and the subtler `provided === process.env.SECRET`, which passes when both sides are `undefined`.

The worst was `deploy-monitor.js`. An unset `DEPLOY_WEBHOOK_SECRET` logged a warning, set `authMethod = 'unauthenticated_dev'`, and processed the webhook — and that webhook drives an autofix pipeline that spends `ANTHROPIC_API_KEY` and **pushes commits using `GH_PAT`**. A forged Vercel deployment-failure event could get attacker-chosen code committed on the project's own credentials. `deploy-autofix.js` fell back to a Host-header "same-origin" check, which is identical for an internal caller and for an attacker POSTing to the public domain.

Fourteen are fixed and live. A misconfiguration should never silently become an authorization decision.

## Money

Twenty read-modify-write sequences across eleven routes computed a new balance in JavaScript from a previously-read value. Two concurrent requests both read the old number and the second write erases the first — a double-tapped rebuy takes the cash twice and records it once; ending a session twice refunds the unused minutes twice. `comps/balances.js` already carried the correct optimistic-lock guard on two of its four write paths, so the pattern was known here and simply not applied consistently.

All twenty now route through `SECURITY DEFINER` functions performing a single atomic `UPDATE ... SET col = col + delta RETURNING col`, with invariants that raise rather than clamp. Idempotency keys were added to the highest-value tables so a retry is indistinguishable from the first call. Demonstrated by forcing the losing interleaving: the old code lost $10.00 of a $135 expected total; the new path returns $135.00.

Four money columns were the wrong type, and every write against them had been silently rejected:

| Column | Was | Consequence |
| --- | --- | --- |
| `commander_tournament_entries.payout_amount` | `integer` | every ICM chop with cents rejected; the tournament row still recorded the deal and returned `success: true` |
| `commander_time_purchases.venue_id` | `uuid` | zero rows ever — cash collected with no record |
| `commander_buyin_transactions.venue_id` | `uuid` | zero rows ever |
| `commander_tournament_points.leaderboard_id` | absent | no player has ever earned a leaderboard point |

`commander_member_comp_log` was missing `comp_category` and `notes` entirely while every insert supplied both, so **the comp ledger has recorded nothing since 2026-03-02** — and `voidComp`'s double-void guard matched on `notes`, so a comp could be voided repeatedly, reversing the balance each time.

The tournament payouts screen computed chops with `payout[i] * (i===0 ? p : (1-p)*p)` under a comment calling it "the Malmuth-Harville approximation". It is not one; the terms do not sum to 1. Heads-up 80/20 on a $10,000 pool paying 6000/4000, it handed the short stack **$1,840 where true ICM gives $4,400**, assigning $2,720 to nobody. The exact ICM helper written earlier in this audit was already in `src/lib/`, imported only by a read-only clock display — the page that actually saves money never used it.

Also closed: the kiosk credited purchased minutes to **both** the member balance and the session clock while deducting from neither; it accepted a **forged staff session** on an endpoint that mints prepaid minutes; and `sessions/[id]/buyin.js` did `100 + "50"` on money, turning a $100 buy-in into **$10,050**.

## Reports that looked like controls

Three reports queried columns that do not exist. Because the callers discarded the error, venue revenue returned **$0**, cashier drawer reconciliation returned **HTTP 500**, and member hours returned **empty**. After repair, the same venue and date range reports $6,525 in tournament fees against $43,670 in prize pools, and the member leaderboard ranks 99 players against 4,663 recorded visits.

The cashier reconciliation matters most, because a reconciliation report that 500s is worse than none at all — it looks like a control while catching nothing. But the per-cashier split, which is the entire point, **could not be restored from the schema**: nothing tied a tournament entry to the staff member who took the money. Rather than substitute a plausible-looking column, the report now returns the totals it can derive plus `cashier_attribution_available: false` and a note explaining why.

Three columns were then added to make the control real: `commander_tournament_entries.cashier_staff_id` and `.payment_method`, and `commander_cash_transactions.tournament_id`. Registration populates the first **only from a verified staff session** — never from a request body, or the attribution is forgeable and the control is worthless.

That wiring caught two landmines worth recording. `verifyStaffSession` has an owner-subscription fallback returning a synthetic staff object whose `id` is an auth user id, not a `commander_staff` row; writing it would have violated the new foreign key and **rejected the entire registration insert**. And the two `payment_method` CHECK vocabularies disagreed, so forwarding a legal entry value like `credit` to the cash ledger would have rejected the buy-in row. Both are handled; the vocabularies are now reconciled.

## Realtime that was wired to nothing

`useCommanderSync` subscribed to `commander_settings` — **a table that has never existed**. Fifteen call sites request that entity, including the ticker on ten screens, and because `channelManager` opens one shared channel per venue spanning the union of all subscribers' tables, a dead binding put its neighbours at risk. Corrected to `commander_venue_settings` in all three vendored copies plus upstream.

Separately, only 6 of the 20 subscribed tables were members of the `supabase_realtime` publication, so most bindings could never fire. Ten were added — every one whose RLS actually permits a browser to read. Four were **deliberately left out**: `commander_floor_calls`, `commander_table_sessions`, `commander_dealer_rotations` and `commander_streams` carry deny-all policies, so realtime can never deliver them to a browser no matter what is published.

That last point has an operational consequence. `commander_floor_calls` being deny-all means the 20-second FloorCallAlert poll added the previous day is **not a safety net behind realtime — it is the only live path**.

## The largest finding is an inventory

An AST scan of both repositories — 2,927 files, 18,903 database column references, zero parse errors — validated every static reference against the live schema.

**307 distinct invalid `table.column` pairs across 493 call sites.** Eight files were repaired. **Roughly 479 sites remain.**

This is the same defect class as the reports above, and it fails the same silent way. Notable clusters:

- `commander_equipment_rentals` — **17 invalid columns on a single insert**. The table is a different shape than the code assumes; this is not a rename, and the equipment marketplace cannot be working.
- `commander_tax_events` — w2g and withholding fields. A compliance surface.
- `hand_history` — 14 invalid columns across the World Hub poker engine.
- `commander_push_subscriptions`, `commander_spending_limits`, `commander_service_requests` — writes, i.e. features that record nothing.
- `profiles.stripe_customer_id` and `commander_subscriptions.current_period_start/end` in the Stripe webhook — billing writes.

Plus **14 PostgREST embeds with no foreign key path at all** (each errors the whole query) and **2 ambiguous embeds** with two possible FK paths, which PostgREST rejects outright.

These were **not** fixed, and the reason is deliberate: each needs a product-intent decision. Substituting a similar-looking column into a tax record or a billing write is precisely the failure this audit has spent four days finding. A wrong number in a money or compliance report is worse than a missing one, because someone will reconcile against it.

## Process notes worth keeping

**Byte-level verification earned its place three times.** Three separate pushes landed subtly corrupted — a comment rule shortened from 43 box-drawing characters to 31, another from 79 to 61, and one extra blank line. All three were comment-only with no behavioural change, and **all three were caught solely by comparing the origin blob SHA and byte size against `git hash-object`**. Reading the diff would not have found any of them. One was live on `main` in an unreviewed state for two tool calls.

A related self-inflicted hazard: `String.prototype.replace` interprets `$$` in the replacement string, which silently ate a literal `$` from a `notes` field, turning `$500` into `500`. Caught pre-push by auditing `$$` counts against `HEAD`.

**Verifying with the wrong tool proves nothing.** A dealer-name fix was "proven" with SQL containing an explicit `LEFT JOIN`, which passed — while the shipped code used a PostgREST embed that failed. SQL equivalence is not evidence; only the HTTP response from the deployed build is.

## Open questions that need an owner

1. **Which page does a physical dealer tablet load?** If `table-tablets.js`, it already does PIN login and ships the session header, so four of the five unauthenticated dealer routes could take `guardStaff` today with no UI change. If `player/[tableNumber].js`, no credential exists and the current hardening is the ceiling. This is a deployment fact, not something the repository reveals.
2. **Should `player-scan-in` keep its `member_number` fallback?** The QR carries real entropy; member numbers are sequential (`JAQK-00001`, `00002`…), so the fallback destroys it — and scanning a member in zeroes their prepaid time balance.
3. **The ~479 remaining invalid column references.** Full inventory produced. Each cluster needs someone who knows what the feature was meant to record.
4. **`commander_sessions.venue_id` is `uuid` while `poker_venues.id` is `integer`** — that filter can never match. The daily export was repointed to correct column names and now fails loudly, but which table it should read is an owner decision.
5. **Three treasury functions** (`fn_apply_credit_payment`, `fn_horse_fund_from_treasury`, `fn_horse_seat_from_treasury`) still perform privileged money movement with no internal `auth.uid()` check. `anon` was revoked; `authenticated` had to be preserved because the club-arena SPA calls them from the browser.

## Data hygiene, not code

Every `commander_table_sessions` row at the audited venue started **2026-02-28**, so every countdown computes to zero and every seat reads `EXPIRED` on both the Commander floor and the public board. Ninety-two rows have been marked `active` since February. This is a seeded dataset nobody advanced, not a live floor — worth confirming before those 19 tables are treated as real.
