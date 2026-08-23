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

---

# Second pass — the remainder

Everything above shipped in PRs #51 / #663 / #674. This section covers the rest
of the audit list, shipped in #54.

## An undo that did not undo

`eliminate.js` does more than mark an entry eliminated. Two of its side effects
had no reversal at all, and both corrupt something quietly:

- **It auto-seats an alternate** into the freed chair while late registration
  is open. `restore.js` did not know that, so undoing a bust put the original
  player back *as well* and the field grew by one. Field size is exactly what
  `commander_claim_finish_position` counts, so every place handed out from that
  moment was shifted. `eliminate` now stamps `promoted_for_entry` and `restore`
  names the replacement.

  It **reports rather than demotes** on purpose. The alternate has been sitting
  and playing hands; deciding which of two real people keeps the seat is a
  floor call, not something an undo endpoint should make silently.

- **It publishes a story** — "IN THE MONEY! Finished 5th In X, $Y" — to the
  player's public feed. The row carried no reference to the tournament or the
  entry, so nothing could find it afterwards. A bust reversed thirty seconds
  later left the post up permanently. It now sets `link_url` (which also makes
  the story clickable through to the event) and a forced undo retracts it.

## A break at the final table did nothing

The break toggle matched `'running'` to pause and `'paused'` to resume.
`'final_table'` matched neither, so `on_break` flipped true while `isRunning`
stayed true: every display in the room showed BREAK while the timer kept
counting the level down, and ending the break did nothing either. The final
table is the one place a break is watched by everybody.

The pre-break status is now remembered so resuming returns to `'final_table'`
rather than demoting the event to `'running'` — and it is in
`CARRIED_CLOCK_FIELDS`, because otherwise any pause or level change taken
during the break would erase it and the demotion would happen anyway.

## Money that was promised but not funded

A satellite with an explicit `seats_awarded` emits its seat rows at full value
regardless of the pool: five seats at $2,500 against a $10,000 pool schedules
$12,500. Nothing complained — the bubble remainder floors at 0, and `overlay`
is measured against `guaranteed_pool` so it stays 0 — so the TD was shown a
seat schedule the pool does not fund and only learned otherwise when the
reconciliation raised `PAYOUTS_EXCEED_PRIZE_POOL`, after the seats had been
awarded. Now surfaced as `seat_shortfall` on the payouts screen.

## Comments that overstated the guard

Seventeen route headers read *"Auth: STAFF_WRITE — requires manager or owner
role"*. Neither `guardStaff` nor `guardWriteStaff` performs any role check, so
every role in `commander_staff` — dealer and brush included — passes. That is
worse than no comment, because the next reader trusts it and stops looking.

Corrected to state what is enforced. **Whether the cash-taking routes should be
manager-only is left open deliberately**: `rebuy` and `addon` move real money,
but floor and cashier staff ringing up rebuys is normal in a card room, and
locking them out mid-session is a product decision with a 2am failure mode. It
is Dan's call, not a bug fix.

Related and fixed: ten POST-only routes used `guardWriteStaff`, whose GET
pass-through returns the **boolean** `true`. `rebuy` and `addon` read `_g.id`
for money attribution, which would silently become `undefined` if the method
check were ever reordered. They now use `guardStaff` — identical behaviour
today, no trap tomorrow.

## Dead code, and one duplicate that mattered

`validateTournamentPayload` existed twice, byte for byte: exported from
`index.js` (imported by nothing) and re-declared privately in `[id].js`. Create
and update could drift, and update is the half that runs after an event is live
with entries in it. Now one shared module.

Removed outright: `findOpenSeat` (exported, imported nowhere, and a non-atomic
re-implementation of `commander_claim_open_seat` — precisely the read-then-write
that caused duplicate seat assignments), `batchSummary`, `PAYOUT_DENOMINATIONS`.

Also: `clone.js` copies `is_multi_day` but dropped `resume_time`, so every
cloned Day 1 printed bag tags with a blank return time; `notify.js` built
"Your Seat Is Ready: Table 4, Seat 7" from the request body rather than the
player's actual chair; `notify-alternates` turned `limit: 0` into `limit: 1`;
and the `payout` GET, which recomputes the ladder across the whole field, was
the only read in the tournament path with no rate limit.
