# Bounty cash is not a drawer variance — settled, not outstanding

**Date:** 2026-08-22
**Decided by:** Dan
**Status:** CLOSED. This is the answer, not a deferral.

## Why this file exists

Three consecutive Tournament Director handoffs have carried "bounty payouts
have no ledger event" as **open item #1**, each time implying the next agent
should build one. That framing is wrong, and re-deriving the argument from
scratch every session has already cost more than the thing would have.

The behaviour is deliberate. It is written down here so it stops being
rediscovered as a defect.

## What actually happens

A bounty is paid **at the table, from the dealer's rack, the instant the
knockout happens.** It does not pass through the cage. No `cash_out` row is
written for it and none should be.

`applyKnockoutBounty()` in `src/lib/commander/tournamentBounty.js` records the
award on the eliminator's entry row — `bounty_winnings`, `bounties_collected`,
`bounty_value` — and stamps `bounty_claimed_value` / `bounty_claimed_by` /
`bounty_claimed_at` onto the busted entry so the head cannot be paid twice and
an elimination undo can restore it exactly. That is the record.

## Why the drawer deliberately excludes it

`pages/api/tournaments/[id]/reconciliation.js` computes two figures:

```
expected_out.total                    = payouts only          <- the drawer balances on this
expected_out.total_including_bounties = payouts + bounties    <- reported alongside
```

Including bounty cash in `expected_out.total` made **every bounty and PKO event
report as short by exactly the bounty total**. A variance that is always
present and always expected is worse than no variance at all: it trains the
cage to dismiss the number, and the next time the drawer is genuinely short
nobody looks. The drawer therefore reconciles on cage money only.

Bounty money is not unchecked. It is reported as its own line, carries the
`bounty_paid_at_table` flag, and is validated against the collected bounty pool
by `BOUNTY_WINNINGS_EXCEED_POOL`.

## What was considered and rejected (2026-08-22)

**A dedicated `commander_bounty_events` ledger** — one row per knockout, with
reversing rows on undo. It would give a per-knockout audit trail and let the
reconciliation report a real variance between the ledger and the entry totals.

Rejected because it buys an audit trail for cash that **the cage never holds**.
The house's exposure is bounded by the bounty pool, which is already collected
up front and already checked. The entry rows plus the `bounty_claimed_*`
metadata already answer "who was paid what, by whom, when". A second system of
record for money that never enters the drawer is reconciliation the venue does
not perform, and it would need its own reversal semantics, its own backfill for
every historic event, and its own drift risk against `bounty_winnings`.

**Adding a `bounty_payout` type to `commander_cash_transactions`** — rejected
harder. That table means "the cage drawer". Roughly twenty surfaces sum it, and
every one of them would have to learn to exclude the new type. The first that
forgot would silently reintroduce the permanent-shortfall bug above.

## If this is ever reopened

The trigger would be a venue that pays bounties **from the cage** rather than
at the table — a legitimate house rule, just not this one. That is a
per-venue setting, not a schema gap, and it would belong in
`commander_venue_settings` with the reconciliation choosing which total to
balance on. Do not build the ledger without that requirement actually existing.

## Related

- `pages/api/tournaments/[id]/reconciliation.js` — the two totals, and the comment block explaining the split
- `src/lib/commander/tournamentBounty.js` — `applyKnockoutBounty` / `reverseKnockoutBounty`
- `pages/api/tournaments/[id]/payout.js` — `prize = buyin - bounty` unless `settings.bounty.on_top`
