# Security Hardening — RPC Execute Grants and Commander Access Enumeration

**Date:** 2026-07-27 · **Project:** `kuklfnapbkmacvwxktbh` (PokerIQ-Production)

Supabase's own security advisors were run across the database for the first time in this audit series. They returned **15 ERROR, 375 WARN, 9 INFO**. This record covers what was fixed, what was deliberately left alone, and why.

---

## A defect I introduced, and fixed

Postgres grants `EXECUTE` on every new function to `PUBLIC` by default. `anon` and `authenticated` inherit that grant, and PostgREST publishes it at `/rest/v1/rpc/*`. When I created functions earlier in this audit I revoked those grants on the admin-PIN functions but **not** on the rest.

Two of the functions I left exposed — `issue_manual_comp` and `redeem_comps` — move real comp balances at venues, and were callable by `anon` with no session at all. Ten of my functions in total were reachable by roles that had no business invoking them. All ten are called exclusively from server routes using the service role, so `anon` and `authenticated` were revoked outright with no behaviour change.

The lesson generalises: any future `SECURITY DEFINER` function in this database needs an explicit `revoke ... from public` unless a browser is genuinely meant to call it.

## Commander access could be enumerated by any logged-in user

`has_commander_access(p_user_id)` and `get_commander_access_details(p_user_id)` took the identity as a parameter and trusted it, with no `auth.uid()` check.

The server-side caller was never exploitable: `pages/api/check-access.js` derives the id from a Bearer token validated through `supabaseAdmin.auth.getUser(token)`. But because both functions were executable by `authenticated`, any logged-in user could call them directly over PostgREST with someone else's uuid and learn whether that person owns venues — along with their venue ids, club ids and names, and home-group ids and names.

Both now resolve the caller's own identity from `auth.uid()` unless the caller is the service role, which the API route uses and which retains full capability. Verified after the change: with `role=service_role` a real owner still resolves `hasAccess=true` with four associated objects, while an anonymous caller asking about that same user gets `hasAccess=false`.

## Treasury functions: anon removed, `authenticated` preserved

`fn_apply_credit_payment`, `fn_horse_fund_from_treasury` and `fn_horse_seat_from_treasury` are `SECURITY DEFINER`, carry **no internal `auth.uid()` check**, and were callable by `anon`.

These are not mine and they are genuinely called from the browser — club-arena is a Vite SPA whose `CreditService.ts`, `SettlementService.ts` and `ServiceBootstrap.ts` invoke them directly with a logged-in session. Revoking `authenticated` would have broken live functionality, so the fix was narrower: drop the `PUBLIC` grant (which is what `anon` was actually inheriting — revoking from `anon` alone is a no-op) and re-grant `authenticated` explicitly.

**This does not make them safe.** They still perform privileged money movement without verifying that the caller is entitled to act on the club, agent or table passed in. Closing that properly means adding internal authorization to functions whose settlement and agent-credit semantics are not defined anywhere in the code I can read, and guessing at money rules is not something this audit will do. It needs a decision from someone who owns that domain.

## Not fixed — reported instead

The advisors surfaced a large amount that sits outside Commander and outside what can be safely changed without product input.

Twelve public tables have RLS switched off entirely, including writable operational state such as `solver_status`, `solver_manifest`, `solver_pipeline`, `sp_pending_family_cache`, `sp_combo_class`, `bet_type_reliability` and the `sim_*` tables. Anyone with the publishable key can read and write them through PostgREST, which is a direct path to poisoning solver and simulation state.

`public.venue_news` carries three write policies that are unconditionally `true` (`venue_news_auth_update`, `venue_news_auth_delete`, `venue_news_auth_write`), so any signed-in player can rewrite or delete any venue's news.

Three views are `SECURITY DEFINER`, meaning queries against them bypass the caller's RLS, and `auth_health_view` in particular leaks auth-system state. A further 302 functions are executable by `authenticated` and 54 by `anon`; the ones spot-checked here that do carry an internal `auth.uid()` check (`fn_claim_rakeback`, `fn_create_agent`, `fn_admin_update_agent`, `fn_union_deposit_from_wallet`) will fail closed for anon, but the full set has not been individually verified.

Ten functions have a mutable `search_path`, and four extensions (`postgis`, `pg_trgm`, `plpgsql_check`, `vector`) live in `public`.

`commander_admin_pins` appears as INFO "RLS enabled, no policy" — that is intentional and correct: it is service-role-only by design and fails closed.

## Verification

Final grant state was re-queried after both migrations. All twelve audit-created functions show `anon=false, authenticated=false`. The three treasury functions show `anon=false, authenticated=true`. The two Commander access functions show `anon=false, authenticated=true` with identity now pinned to `auth.uid()` internally. Both migrations carried post-condition blocks that raise rather than half-apply, including an explicit guard that `authenticated` did not lose access to the treasury functions.
