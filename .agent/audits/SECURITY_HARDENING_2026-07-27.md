# Security Hardening — Database Audit

**Date:** 2026-07-27 / 28 · **Project:** `kuklfnapbkmacvwxktbh` (PokerIQ-Production)

Supabase's own security advisors were run across the database for the first time in this audit series. The opening run returned **15 ERROR, 375 WARN, 9 INFO**. After nine migrations the count is **1 ERROR, 312 WARN, 20 INFO**, and the single remaining ERROR is one this account cannot fix.

This record covers what was fixed, what was deliberately left alone, and why.

---

## A defect I introduced, and fixed

Postgres grants `EXECUTE` on every new function to `PUBLIC` by default. `anon` and `authenticated` inherit that grant, and PostgREST publishes it at `/rest/v1/rpc/*`. When I created functions earlier in this audit I revoked those grants on the admin-PIN functions but **not** on the rest.

Two of the functions I left exposed — `issue_manual_comp` and `redeem_comps` — move real comp balances at venues, and were callable by `anon` with no session at all. Ten of my functions in total were reachable by roles that had no business invoking them. All ten are called exclusively from server routes using the service role, so `anon` and `authenticated` were revoked outright with no behaviour change.

The lesson generalises, and it recurred twice more below: any `SECURITY DEFINER` function in this database needs an explicit `revoke ... from public` unless a browser is genuinely meant to call it, and **revoking from `anon` alone is a silent no-op** whenever the privilege is actually held by `PUBLIC`.

## Commander access could be enumerated by any logged-in user

`has_commander_access(p_user_id)` and `get_commander_access_details(p_user_id)` took the identity as a parameter and trusted it, with no `auth.uid()` check.

The server-side caller was never exploitable: `pages/api/check-access.js` derives the id from a Bearer token validated through `supabaseAdmin.auth.getUser(token)`. But because both functions were executable by `authenticated`, any logged-in user could call them directly over PostgREST with someone else's uuid and learn whether that person owns venues — along with their venue ids, club ids and names, and home-group ids and names.

Both now resolve the caller's own identity from `auth.uid()` unless the caller is the service role, which the API route uses and which retains full capability. Verified after the change: with `role=service_role` a real owner still resolves `hasAccess=true` with four associated objects, while an anonymous caller asking about that same user gets `hasAccess=false`.

## Eleven pipeline tables had RLS switched off entirely

`solver_status`, `solver_manifest`, `solver_pipeline`, `sp_pending_family_cache`, `sp_combo_class`, `bet_type_reliability`, `sim_baseline_compare`, `sim_bet_grade_summary`, `sim_equity_daily`, `sim_market_summary` and `sim_risk_metrics` were readable *and writable* by anyone holding the publishable key — a direct path to poisoning solver and simulation state. RLS was enabled on all eleven and the `PUBLIC` grants dropped.

## A performance fix that traded away two security fixes

`20260520000006_final_micro_policy_fixes.sql` was written to clear 21 `multiple_permissive_policies` warnings. Those are **performance** advisories. In the course of clearing them it widened two policies:

`venue_news` gained three write policies that were unconditionally `true`, so any signed-in player could rewrite or delete any venue's news. All three were dropped; the table now carries only a service-role write policy and a public read.

`live_gifts` was worse, because it was a regression of two prior security fixes. The table's history reads:

| Migration | Effect |
| --- | --- |
| `20260430_live_streaming_missing_infra` | created `lg_ins WITH CHECK (true)` |
| `20260501_harden_live_gifts_rls` | tightened to `sender_id = auth.uid()` |
| `20260503_live_gifts_rls_api_only` | locked to `WITH CHECK (false)` |
| `20260520000006_final_micro_policy_fixes` | **dropped that, recreated `WITH CHECK (true)` for `authenticated`** |

The migration's own inline comment concedes it did not understand the warning — *"the advisor may be flagging something else… this warning may be a false positive"* — and dropped the security policy anyway. The result was that any logged-in user could POST a fabricated row to `/rest/v1/live_gifts` with an arbitrary sender, receiver and amount, with no diamond ever deducted, poisoning the gift feed, gift analytics and leaderboards. That is precisely what the two earlier migrations existed to prevent.

`WITH CHECK (false)` is restored. Every legitimate writer was verified unaffected first: `pages/api/live/gift.js` builds its client from `SUPABASE_SERVICE_ROLE_KEY`, and `send_stream_gift()` is `SECURITY DEFINER` owned by `postgres`, which carries `BYPASSRLS`. No browser code in any of the five repositories writes to the table.

A warning block was appended to `20260520000006` in the repo so the pattern is not copied.

## Three SECURITY DEFINER views, one of them serious

A view owned by `postgres` without `security_invoker` runs its query as the *owner*, so RLS on the underlying tables does not constrain whoever queries the view. All three were `SELECT`-able by `anon`.

`horse_hand_results` is the one that matters. It explodes `public.hand_history` for every non-tournament hand in the last 24 hours into per-player, per-street action rows — user id, stage, action, amount, net, net in big blinds. At the moment it was closed it was returning **138,159 rows**. Anyone holding the publishable key could read a rolling live feed of every cash-game player's actions, which in a poker product is directly usable to profile and exploit opponents in real time. This is the single most damaging read found in the whole audit.

`horse_style_performance` aggregates that view against `profiles`. `auth_health_view` aggregates `probe_heartbeats` and leaks which signup, login and recovery probes are currently failing — useful reconnaissance for timing an attack against auth while it is already degraded.

All three were set to `security_invoker = true` and had their grants revoked down to `service_role`. The only verified readers, `pages/admin/auth-health.js` and `pages/api/admin/auth-health-data.js`, both use the service role and are unaffected; `horse_hand_results` and `horse_style_performance` have zero code references in any of the five repositories.

## Twenty-four unauthenticated SECURITY DEFINER functions

Twenty-four `SECURITY DEFINER` functions were `anon`-executable while containing no reference to `auth.uid()`, `auth.jwt()`, `auth.role()` or the request JWT. Each was triaged against its real call sites before anything changed, which split them three ways.

Five are genuinely invoked from the browser by the club-arena SPA with a logged-in session, so they kept `authenticated` and lost only `PUBLIC`/`anon`: `fn_bbj_promo_payout_atomic` (pays a bad-beat-jackpot pool out to an arbitrary array of recipients — anonymously callable, this was a direct mint), `fn_member_leave_to_treasury` (sweeps a departing member's club balance), `fn_generate_credit_invoice` and `fn_generate_all_credit_invoices` (create agent debt records), and `fn_sync_tournament_chips` (rewrites chip counts for an entire tournament from a jsonb payload).

Eight lost every non-service grant because no browser calls them at all: `get_daily_commission_summary` and `sum_agent_commissions` (leaked club and agent commission financials), `fn_submit_bug_report_to_admin` (takes `p_sender_id` and trusts it, so `anon` could file reports impersonating any user), the two trigger functions `fn_hg_enforce_rsvp_capacity` and `fn_update_messenger_conversation_last_message`, and `fn_sync_agent_player_counts`, `fn_sync_share_streak_multiplier` and `get_source_tier_available`.

Five MLB and betting analytics functions lost `anon` but kept `authenticated`, because the shipping MLB routes talk to a **different** Supabase project via `getMlbSupabase()` and these copies have no verified caller in this one.

Four were deliberately left alone. `get_public_profile_by_username` is called client-side from `pages/u/[username].js` by logged-out visitors and exists precisely so `anon` can read a display-safe subset of `profiles` without holding `SELECT` on the table. `find_live_games_nearby` is the public game finder, `find_similar_questions` is a read-only dedupe helper, and `st_estimatedextent` is PostGIS.

The twenty-five `SECURITY DEFINER` functions still `anon`-executable after this pass all carry an internal `auth.uid()` check and fail closed, or are the four above.

## Search path pinned on ten functions

Ten project-owned functions had a mutable `search_path`, so unqualified names resolved against whatever the caller's `search_path` happened to be. None are `SECURITY DEFINER`, so this is hardening rather than an open hole, but a caller able to create objects in an earlier schema could still shadow a table these functions depend on. All ten now carry `search_path = public, pg_temp`, with `pg_temp` last so a caller's temporary objects cannot take precedence. Extension-owned functions were excluded deliberately — altering them would be undone by the next extension upgrade.

## Not fixed — reported instead

**`spatial_ref_sys`** is the one remaining ERROR. It is a PostGIS table owned by `supabase_admin`; this audit connects as `postgres`, which is not a member of that role, so `ALTER TABLE … ENABLE ROW LEVEL SECURITY` genuinely cannot be issued. It contains only the public EPSG coordinate-system reference data. Closing it requires Supabase support or a dashboard action.

**The three treasury functions** — `fn_apply_credit_payment`, `fn_horse_fund_from_treasury`, `fn_horse_seat_from_treasury` — are `SECURITY DEFINER`, carry **no internal `auth.uid()` check**, and were callable by `anon`. They are genuinely called from the browser by club-arena's `CreditService.ts`, `SettlementService.ts` and `ServiceBootstrap.ts`, so the fix was narrow: drop the `PUBLIC` grant and re-grant `authenticated` explicitly. **This does not make them safe.** They still perform privileged money movement without verifying that the caller is entitled to act on the club, agent or table passed in. Closing that properly means adding internal authorization to functions whose settlement and agent-credit semantics are not defined anywhere in the code I can read, and guessing at money rules is not something this audit will do. It needs a decision from someone who owns that domain. The same reservation applies to the five browser-invoked functions above that kept `authenticated`.

**282 functions remain executable by `authenticated`.** Spot-checked members of that set do carry internal `auth.uid()` checks, but the full set has not been individually verified, and at that size a mechanical sweep would produce more risk than signal.

**Four extensions** (`postgis`, `pg_trgm`, `plpgsql_check`, `vector`) live in `public`. Relocating them is a breaking change to every call site and belongs in its own planned migration.

**`training_leaderboard_top`** is a materialized view exposed through the API, which is what `materialized_view_in_api` flags — matviews cannot carry RLS. Its columns are rank, user id and training statistics, with no PII, and a leaderboard is public by design. Accepted as-is.

**`commander_admin_pins`** appears as INFO "RLS enabled, no policy". That is intentional and correct: it is service-role-only by design and fails closed.

## Verification

Every migration carried a post-condition block that raises rather than half-applies, including explicit guards that `authenticated` did not lose access where a browser depends on it.

A twenty-check role-simulation suite was then run inside a transaction that was rolled back, so nothing was written. Under `SET ROLE authenticated`, a direct insert into `live_gifts` was denied by RLS. Under `SET ROLE anon`, all three views returned permission denied, `get_public_profile_by_username` remained callable, and all six sampled money and analytics functions confirmed revoked. Under `SET ROLE service_role`, the three views still returned 1, 138,159 and 35 rows respectively.

The final advisor run: **1 ERROR** (`spatial_ref_sys`), down from 15. `function_search_path_mutable` is at zero, down from 10. `anon_security_definer_function_executable` is at 25, down from 54 — and every remaining member either checks identity internally or is intentionally public.

An earlier smoke test in the World Hub pass inserted one row into `promo_wagering_ledger` — a sentinel UUID was passed where NULL was intended. It was identified in the same query's output and deleted; the ledger is confirmed empty. No other test in this audit wrote to production.

## Repository state

All nine migrations were applied through the Supabase MCP, which records them in `supabase_migrations.schema_migrations` but does not write files. They have been mirrored into `Smarter-Poker-World-Hub/supabase/migrations/` and pushed, verified byte-for-byte by comparing each file's `git hash-object` against the blob SHA returned by the GitHub API. Without that step a `supabase db reset` would have replayed `20260520000006` and silently reopened both the `live_gifts` and `venue_news` holes.
