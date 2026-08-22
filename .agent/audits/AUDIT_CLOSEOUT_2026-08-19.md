# Club Commander / World Hub — Audit Close-Out

**Date:** 2026-08-19 · **Project:** Supabase `kuklfnapbkmacvwxktbh` · **Repos:** `smarter-poker-commander`, `Smarter-Poker-World-Hub`

Closing record for the audit, upgrade and hardening series. Every claim below was
verified against live production or the live database at close-out, not assumed
from the fact that a migration ran.

---

## Verified intact at close-out

Ten days of parallel development happened between the last working phase and this
close-out, so the first thing checked was whether the work survived. It did — all
ten load-bearing fixes re-verified green on 2026-08-19:

| Fix | State |
| --- | --- |
| `player_stats_snapshots` RLS enabled | on |
| anon blocked from `player_stats_snapshots` | blocked |
| anon blocked from `fn_club_leaderboard_period` | blocked |
| client roles blocked from `sum_diamond_transactions` | blocked |
| client roles blocked from `fn_send_message` | blocked |
| client roles blocked from `fn_get_user_conversations` | blocked |
| client roles blocked from `fn_training_leaderboard_record` | blocked |
| identity pin on `get_profile_picture_history` | present |
| `commander_tournaments.leaderboard_id` + `final_payouts` | present |
| `commander_tournament_entries.payout_amount` = numeric | numeric |

The `SharePostModal.jsx` fix was likewise confirmed merged into `origin/main` and
present in the working tree at today's HEAD.

## The defect class that mattered most

One pattern accounted for the majority of the serious findings, in four distinct
disguises. In each case a control **looked** applied and was not:

1. **The `PUBLIC` grant trap.** `REVOKE ... FROM anon` is a silent no-op when the
   privilege is actually held by `PUBLIC`. Hit twice before it was internalised;
   every revoke in this series therefore names `public` explicitly.
2. **The broken PostgREST embed.** `commander_dealers:dealer_id (...)` resolved
   through no foreign key, so PostgREST rejected the *entire* query and returned
   `null` — which the call site coerced away with `|| []`. Dealer names had almost
   certainly never once appeared.
3. **The `SECURITY DEFINER` side door.** Enabling RLS on a table does not protect
   it if a definer-owned function reads it and a client role can execute that
   function. Locking `player_stats_snapshots` closed the front door; three
   leaderboard RPCs still returned every player's winnings, losses and rake to a
   caller with no session at all until they were closed too.
4. **Parameter-name binding.** PostgREST binds RPC arguments *by name*. A call
   passing `user1_id`/`user2_id` to a function declared `p_user_id`/
   `p_other_user_id` returns PGRST202 and never executes — silently.

The unifying lesson: **a control must be verified by exercising it, not by
confirming the statement that created it succeeded.** Every fix in this series was
therefore proven by execution — simulating the attacker role and confirming denial,
then simulating the legitimate caller and confirming continued access.

## Representative fixes

**Compliance.** `tournaments/[id]/payout.js` selected a non-existent
`leaderboard_id`; the read failed, `tournament` came back null, and the very next
line — `if (amount >= 5000 && tournament)` — skipped the W-2G tax-event insert.
Every tournament payout at or above the federal filing threshold had produced no
tax record. Adding the column restored it.

**Privacy.** An unauthenticated, service-role `GET` on `/api/social/pages/games`
published a real-time roster of every player's full legal name and table at a
club. Names and dealer names are now redacted server-side to `First L.`, matching
the format the public TV endpoint already used.

**Money.** Twenty read-modify-write sequences computed balances in JavaScript;
concurrent requests silently erased one another. All now route through atomic
`UPDATE ... SET col = col + delta` functions. Demonstrated by forcing the losing
interleaving: the old pattern loses $10 of a $135 expected total, the new one
returns $135.00.

**Correctness.** The tournament payouts screen computed chops with a formula whose
terms do not sum to 1, under a comment calling it Malmuth-Harville. Heads-up 80/20
on a $10,000 pool, it handed the short stack $1,840 where true ICM gives $4,400 and
assigned $2,720 to nobody. The exact solver already existed in the codebase,
imported only by a read-only display.

## Open — needs an owner, not more automation

1. **Dealer tablet authentication.** Which page a physical tablet loads is a
   deployment fact the repo does not reveal. If `table-tablets.js`, four
   unauthenticated dealer routes could take `guardStaff` today with no UI change.
2. **`player-scan-in` member_number fallback.** Member numbers are sequential, so
   the fallback destroys the QR's entropy — and scanning a member in zeroes their
   prepaid balance.
3. **Leaderboard column exposure.** `fn_club_leaderboard_period` and siblings still
   return `total_losses` and `total_rake` to logged-in users. Ranking needs a
   score, not a financial statement. Column-level product call.
4. **`fn_get_or_create_conversation` identity pin.** Deliberately not pinned: its
   server callers legitimately pass pairs where neither id is the caller, so the
   pin needs a service_role bypass that should be tested against the real cashout
   flow rather than shipped blind.
5. **Treasury functions.** `fn_apply_credit_payment`, `fn_horse_fund_from_treasury`,
   `fn_horse_seat_from_treasury` still move money with no internal `auth.uid()`
   check. `anon` revoked; `authenticated` preserved because the club-arena SPA
   calls them from the browser.
6. **~479 remaining invalid column references.** Full inventory produced by AST
   scan (2,927 files, 18,903 references). Each needs someone who knows what the
   feature was meant to record; substituting a similar-looking column into a tax
   or billing write is the exact failure this audit spent its time finding.

## Process notes worth keeping

**Byte-level verification earned its place repeatedly.** Seven pushes across the
series landed subtly corrupted — box-drawing rules shortened or over-emitted, a
stray trailing newline, one extra blank line, and a `$$` in a replacement string
that silently ate a literal `$` from `$500`. Every one was caught by comparing the
origin blob SHA and byte size against `git hash-object`. **Not one would have been
caught by reading the diff.**

**Verifying with the wrong tool proves nothing.** A dealer-name fix was once
"proven" with SQL containing an explicit `LEFT JOIN` — which passed, while the
shipped code used a PostgREST embed that failed. SQL equivalence is not evidence;
only the response from the deployed build is.

**Concurrency is a real constraint.** This codebase is under active parallel
development. Several times the correct action was to stand down rather than push a
fix derived from a stale snapshot, because another session had already fixed the
same thing better-informed. "Done" is not a state a single session can truthfully
claim on a live, actively-developed system.
