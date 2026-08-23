# Tournament Director hardening — audit and fixes

**Date:** 2026-08-22
**Scope:** `pages/api/tournaments/**` (41 routes, ~25k lines), the TD screens, and
the Commander schema in Supabase.
**Method:** three parallel line-by-line reads of the money, seating and
clock/lifecycle surfaces, every finding re-verified by hand against the code and
the live database before anything was changed.

---

## The one cause behind most of it

Nearly every defect below is the same shape: **a rule written by hand at each
call site instead of once, then omitted at some of them.** Not carelessness —
each individual copy looks careful, several carry thoughtful comments
explaining what they exclude. The comments are just wrong about a value nobody
re-checked against the database.

Three vocabularies caused twenty-plus bugs between them:

| Rule | Written by hand | Wrong at | Now |
|---|---|---|---|
| "is this staff member in this venue" | 17 sites, 3 spellings | omitted at 24 | `src/lib/commander/venueScope.js` |
| "is someone in this chair" | 8 sites | all 8 | `LIVE_SEAT_STATUSES` |
| "what payment methods exist" | 3 sites | 2 | `src/lib/commander/paymentMethods.js` |

---

## P0 — cross-venue access

`guardStaff` proves a session is valid, **not which room it belongs to**, and
the tournament id is a URL parameter. 24 of 41 routes never compared the two.

An ordinary, correctly-signed session for venue A could:

- **reseat venue B's live tournament** — `balance-execute` never loaded the
  tournament at all, writing entries scoped only by `.eq('tournament_id', …)`;
- **end its clock**, **bust its players**, **rewrite their chip stacks**;
- **put cash in its drawer** (`register`, `rebuy`, `addon` all write
  `venue_id: tournament.venue_id`);
- **read its entire field by name** — `floor-view`, `reports`, `export`,
  `balance-suggest`, `auto-break`.

The 17 routes that *did* check used three spellings, two of which fell **open**
on a null or zero venue. All now use one guard that fails **closed** — safe,
because `verifyStaffSession` already guarantees a real `venue_id` on both auth
paths (`auth.js:303` for PIN sessions; the owner path looks the row up by
venue), so no legitimate session is refused.

Two routes had no tournament-not-found guard either: `payout` POST/PUT wrote a
payout against a non-existent event, and `reports?type=activity` never read the
tournament at all, so it had nothing to scope by.

## P0 — finish positions were being handed out from the wrong count

`commander_claim_finish_position` **counted** the field as
`('seated','active','bagged')` but **updated** `('registered','seated','active','bagged')`.
A registered entry could be busted out of a field it was never counted in, and
payouts derive from the place.

Six **running** tournaments had a counted field of **zero** because every
player was `registered`. The clamp lifted 0 to 1, so *the first player
eliminated would be recorded in 1st place*, and the second bust collided on
`uq_commander_entries_finish_position` — those events could not be played out.

Fixed to count what it eliminates, which is also how `register.js` has always
defined field size. Verified in a rolled-back transaction against a live
12-handed event: first bust now returns place 12, remaining 11.

## P0 — seat occupancy ignored `registered`

Eight probes asked "is anyone in this chair" using `['active','seated']`. The
partial unique index that actually enforces one-player-per-seat covers
`('registered','seated','active')`, and production holds **52 `registered` rows
sitting on a table and seat** against 78 `active` — rooms seat the field before
the clock starts.

A probe *narrower* than the index is the worst available shape: it reports a
taken chair as free, the write is attempted, the index raises 23505, and the
floor is told *"another device filled it first, refresh the table map"* when no
other device did anything. Pressing the button again reproduces it forever.
`break-table` and `DELETE /tables` went further and released tables with players
physically sitting at them.

Related: `seat.js` and `move-player.js` both accepted an `alternate` but neither
wrote a status, so the player ended up in a chair still marked `alternate` —
**outside the index entirely**, invisible to the one constraint that stops two
people sharing a seat. The chair rendered empty while somebody sat in it.
Production was clean; this was latent.

## P0 — privacy

- `tournaments/[id].js` GET is public by design (the live clock page) and
  sanitised the row with a **two-key blacklist over `select('*')`**. Everything
  else went to anonymous callers, including `day_end_chip_counts` — which
  `bag-and-tag` writes as `{ player_name, chips, table_number, seat_number }`,
  i.e. full names against exact overnight stacks — plus `final_payouts` (deal
  amounts carrying `player_id`) and `settings`. A blacklist over `*` fails open
  by construction: every column added later publishes itself.
- `story.js` preferred **request-body** values over the entry row for
  `chip_count`, `finish_position` and `payout_amount`, so any player registered
  in an event could publish *"I Won \<real tournament\>! \$50,000"* in the
  templated format that makes it read as verified.

## P1 — the clock's `+` button removed time

`remaining = duration − (now − levelStartedAt)`, so `levelStartedAt` and
remaining move **together**. `add_time` subtracted from it and `subtract_time`
added — the TD's "+1:00" took a minute off the level on every screen in the
room, and "−1:00" added one. The comments asserted the inverse of the
arithmetic directly above them.

Also: `set_level` accepted `{level: 999}`, freezing every display at 0:00 with
no blinds and no way back but repeated `prev_level`; and `prev_level` at level 0
rebuilt the clock state anyway, restarting the *current* level at full duration.

## P1 — money

- **A chop overwrote the prize pool.** `payouts` on the deal path carries only
  the remaining players, and its sum was written to `actual_prizepool`. A
  \$50,000 event where 4th–9th were already paid \$20,000 and the last three
  chopped \$30,000 recorded a \$30,000 pool — and `effectivePrizePool` prefers
  `actual_prizepool`, so the payouts screen, reconciliation, reports, clock and
  floor-view all adopted it and the ladder was recomputed off it.
- **Save mid-tournament paid players who were still playing.** The calculator
  fills unfilled prize slots from current chip counts and marks them
  `is_projected`; the screen dropped the flag, so nine players still in their
  seats got a real `payout_amount`, and `pay.js` only refuses `<= 0`.
- **Re-entry players could not be paid at all.** The update filtered on
  `player_id`, which matches both bullets; the single route 500'd and the bulk
  route swallowed it — no payout, no W-2G, no points, and an `updated` count
  that under-reported while the pool was still summed from the full list.
- **A chop was being silently restated.** Denomination rounding preserves the
  total but not the split: an even 3-way chop of \$10,000 agreed as
  3334/3333/3333 was stored as 3340/3330/3330. The response carried
  `rounding_remainder`; the screen read only `updated`.
- `getTotalRebuys` had no `.limit()`, so PostgREST's max-rows cap silently
  truncated the scan on a big field and every finisher was paid less than the
  public payouts tab showed.

## P1 — registration gates failed open

`supabase-js` **resolves** rather than rejects on a PostgREST error, so
`Promise.all` never threw and each destructure dropped `error`. Field capacity
(oversell), daily spend limit (skipped), duplicate registration (double charge)
— and **self-exclusion**: a self-excluded player could be registered and
charged.

## Also fixed

Table breaks that emptied a table but never released it (so the next alternate
was seated straight back onto it); break plans that silently dropped players
while reporting the full headcount; `final-table` declaring a final table when
every move failed, after already releasing the target seats; unvalidated
destination seats in `move-player` and `auto-break`; expired floor messages
burned onto the room's screens forever; player self-report dead during breaks
(`'break'` is not a status; `'paused'` is); notifications all recorded as
"tournament starting"; a swallowed 23505 that silently lost leaderboard points;
the overlay banner printing \$0 on the screen used to size overlay exposure;
self-unregister refused during `'registration'`; dead status tokens
(`'registering'`, `'open'`, `'idle'`) that matched nothing.

---

## Verification

CI could not run — GitHub Actions was failing account-wide from ~23:30 UTC
(every workflow in every repo, 0 steps executed, ~2s, 0 billable ms, including
grep-only guards in repos untouched by this work). Verified locally instead:

- `npm test` — 73 pass, including new suites that pin the three vocabularies.
  Each new guard test was verified to **fail** on a reintroduced regression
  before being accepted.
- `npm run build` — compiles, 117/117 pages.
- `check-vendor-drift.mjs` — all three checks pass.
- Every migration applied to production with its own assertions, then verified
  by query; the finish-position fix additionally exercised in a rolled-back
  transaction against a live event.

## Deliberately not done

A bounty ledger. Recorded as a settled decision, with the one condition that
would reopen it, in
`.agent/audits/2026-08-22-bounty-cash-is-not-a-drawer-variance.md`.
