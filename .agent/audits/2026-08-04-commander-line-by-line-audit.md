# Club Commander — Full Line-by-Line Audit + TableCaptain Comparison

Date: 2026-08-04
Scope: every page under `pages/commander/**`, the shared `src/lib` + `src/components` + `vendor/commander-shared` layer, the previously-swept `pages/api/**`, plus a live Supabase security-advisor scan. Method: 7 parallel audit agents reading each file end-to-end, validating every fetch against its real API route and every column/FK against the live production schema (project `kuklfnapbkmacvwxktbh`). Fixes auto-shipped byte-exact to `main`, one file per commit; each re-fetched and diff-verified; JSX parse-checked with esbuild.

Deploy verification: production `commander.smarter.poker` serves HEAD `d1933d97` (Vercel deployment READY). The critical vendor fix (below) is confirmed **live and effective** — the anon key is inlined in the shipped client bundle, so the real Supabase client activates.

---

## 0. Headline finding (P0 — was silently broken in production, now fixed)

**`vendor/commander-shared/src/lib/supabase.js` exported only a no-op test mock in production.** Its header claimed "Next.js always resolves to supabase.ts" — true in World Hub, false here (the vendored copy has no `supabase.ts`). Every package-internal `import { supabase } from '../supabase'` (useCommanderSync, useTournamentRealtime, FloorCallAlert, CommanderLayout) bound to the mock, so:
- **Supabase Realtime never connected** → "cross-device sync" silently degraded to same-browser BroadcastChannel only. Every floor/tables/waitlist/tournament screen only updated in real time within one browser, not across the staff's devices/tablets.
- **FloorCallAlert's 20s safety poll threw** on the mock query builder and was swallowed → floor calls raised from another device never alerted staff.
- **CommanderLayout logout** called `supabase.auth.signOut()` which the mock lacks → the Supabase session survived "Sign Out."

Fixed: real browser client (mirrors `src/lib/supabase.js`, shared `smarter-poker-auth` session, cached on globalThis), with the mock retained only as a no-env test fallback. Verified live: anon key + Supabase URL are present in the deployed client bundle, so the real client is active. This one fix restores genuine cross-device realtime across the entire console.

---

## 1. Fixed this round (~40 commits to main, all live)

### Open decisions resolved
- **PR #24 merged + migration applied**: `commander_table_sessions` gained `rate_per_hour/total_charge/duration_minutes/started_by`; `commander_tax_events` gained `event_date/withholding_rate/w2g_document_url/player_acknowledged/acknowledged_at/notes`. Unbreaks time-billing session records + the W-2G tax route.
- **PR #25 unblocked + applied**: `commander_shift_handoffs.venue_id` converted uuid→integer (matching every sibling table). The 10 legacy rows' orphaned uuid was preserved in a new `venue_id_uuid_legacy` column and NOT-NULL relaxed; rollback documented in the migration. Shift-handoff inserts now work for real integer venue ids.
- **rotations.js**: verified the leftover `parseInt(table_id)` was already removed; break/return columns (`current_status`/`break_started_at`) now exist. Clean.

### Known bug list (audit §2.3) — closed
- home-game event reviews: `comment`→`review_text`, dropped nonexistent `is_anonymous`, response shape preserved (commit `6a02fa5`).
- displays high-hand/jackpot panels: selects now use real columns (`cards`, `board_cards`, `hand_rank`, `player_name`, `table_number`) with PostgREST aliases so TV clients keep their field names; dropped nonexistent `min_qualifying_hand` (commit `52f60cd`).
- seat-preferences: uuid `venue_id` guard added (non-uuid maps to the venue-agnostic null row) — was 22P02-erroring (commit `aacd32a`).
- floor-call: tablet calls now insert `status:'pending'` so they appear in the floor queue (were `'active'`, invisible); 3 stale active rows resolved (commit `14b2677`).
- admin api-keys: reworked to real `key_hash`/`key_prefix` storage — server-generates the key, stores sha256 hash + 12-char prefix, returns the full key once (commit `f1132bf`).
- services/request, venue reviews `review_count`, home-game group members embed: verified already correct on main (no change needed).

### Page bugs found + fixed by the cluster audits
Floor/games: waitlist desk (4 crashes: missing supabase import, undefined ConfirmDialog, missing toast state, AbortSignal misuse — `d1933d9`); floor-calls (`responded_by` uuid, `responded_at`, response-time derivation — `8d64b61`); tables (Close Game via DELETE so table releases; game-type list matched to API — `504e901`); **api/tables/index Add-Table 500** (`_authResult` scope bug — every add returned 500 despite creating the table — `5b59bb4`); must-move refresh (`16b4c86`); shift-handoff realtime (`f067158`); high-hands label fallback (`a54efbe`); open-game fallback reachable (`9a632f2`).

Tournament: control center paused filter + chip field (`e9c9343`); maintenance edit link (`77a2457`); leaderboard-builder venue scoping — cross-venue leak (`251deb4`); clock-display preset path + rebuys field (`60a9626`); public page late-reg/guarantee fields (`a348aaf`); seating-display chip field (`eb83512`); structure-display 4 fields + autoscroll (`bdc626c`); tournament detail chip field (`dd13a34`); TD players `?move=` deep link (`b371dfd`); TD index broadcast/H4H controls wired (`e699e70`).

People/ops: **members/[id] data-corruption fix** (unwrapped `data.member` — Add Time was overwriting the real balance with just the added minutes — `b92afaf`); dealers on-table derivation + rotation history fields (`f6e597f`); time-clock refresh (`99e5681`); dealer tablet bust-out after eliminate (`d3e4c79`).

Admin/misc: settings title (`96aabd6`); exports Hendon Mob shape (`01704fc`); lobby tournaments shape (`3a13eb2`); 4 reports pages fixed (daily-summary auth `f6d7acf`, tax-compliance auth `11f0614`, tournament-results crash `0a1eb00`, player-activity crash `df873fd`, staff-activity triple-fix `07090ce`); admin api-keys modal aligned to hashed schema (`cb32343`); admin PIN-entry open-redirect closed (`48f9346`).

Money: cashier print-card search wired + double-void handling (`be69179`).

Shared layer: **vendor supabase.js P0** (`c7f0b6e`); vendor useClubBranding scope fix ported (`5c850c73`).

---

## 2. Still broken / stubbed (confirmed; need a decision, schema, or build — NOT auto-fixed)

### Dead features (UI present, non-functional)
1. **close-day.js "Close Day" persists nothing** — PIN sign-off just fires confetti; no close record, no report snapshot, shift notes discarded. Needs a `commander_day_closes` table + endpoint.
2. **time-billing.js session machinery has no JSX** — ~40% of the file (session list, Stop/Pay, PIN keypad) is never rendered; the header shows "N active sessions" with no way to act. The dead `doStopSession` also has a broken cashier contract. Needs the UI built + the stop/pay contract corrected (`type:'time_purchase'`, positive amount).
3. **marketplace.js — both money buttons dead**: Book Dealer sends a venue-booking shape the API (`dealers/[id]/book.js`, built for home-game hosts) rejects; Request Rental hits `equipment/[id]/rent.js` which selects/inserts columns that don't exist on `commander_equipment_rentals`. Needs a venue-facing booking/rental API (or repurpose the equipment marketplace properly).
4. **admin VenueSettingsModal saves 500** — PATCHes `comp_rate/auto_text_enabled/waitlist_settings/display_settings` to `commander_venue_settings`; none of those columns exist (real ones: `auto_comp_rate`, `sms_notifications_enabled`, `call_timeout_minutes`, `show_player_names_on_display`). Needs field mapping or columns added.
5. **comps.js "Rate Per Game Type"** tab is hardcoded fiction (multipliers on fixed labels), not data-backed.
6. **admin/pilots.js** Phase-6 checklist is hardcoded `checked={true}`; pilot detail view is a dead click.
7. **cashier.js Transaction History modal** is unreachable (nothing calls `loadPlayerHistory`).
8. Landing page testimonials are placeholder quotes; promotions.js `handleToggle` is dead code.

### Confirmed bugs needing an API/schema change or product call
9. **high-hands ordering is lexicographic** — `hand_rank` is TEXT holding numeric scores, ordered `desc` as strings, so "10" (royal) sorts below "2". Needs a numeric cast in the API or zero-padded storage. (The display label was fixed; the ranking is still wrong.)
10. **PIN-session 401 → login-redirect hazard** — `dealer/hand-count`, `dealers/rotations` POST-assign, and `table-assignments` require a JWT (not the `x-staff-session` header dealer tablets use), so PIN-only tablets get 401 and `commanderFetch` hard-redirects them to `/commander/login`. These guards should accept `x-staff-session` like the sibling dealer routes.
11. **cashier $0-pricing trap** — `membership-plans` GET and `members/[id]` PUT are behind `guardWriteStaff` (manager/owner); on a floor-role terminal the pricing fetch 401s and the page silently falls back to $0 "Free" tiers — memberships could be sold at $0. Loosen the GET guard or handle the 401 explicitly.
12. **cashier QR scan can't match printed cards** — `handleScanResult` searches `/members?search=`, which doesn't cover `qr_code` or UUIDs; the dedicated `/members/scan` endpoint exists but is unused. Wire the scanner to `/members/scan` with a `/members/{id}` fallback.
13. **payout.js API** writes `final_payouts` + `leaderboard_id` (neither exists) → the leaderboard-points side of payouts silently no-ops. Needs the columns or a rewrite onto `commander_tournament_points`.
14. **dealer-rotation history always empty** — the rotations GET filters `ended_at IS NULL`, so "Rotation History"/"Total Rotations Today" can never populate. Needs an `include_ended` API param.
15. **kiosk.js** — no staff-session guard (silent no-ops without a session); shows "Checked In!" even when all PATCHes fail; doesn't record a member visit; falls back to a hardcoded game menu when the waitlist is empty (players can join lists for games not being spread).
16. **money read-modify-write races** — cashier Add-Time and member time/balance updates read-modify-write client-side; concurrent cashiers can lose updates. Comps already use an atomic RPC; cashier/time should follow.
17. member-import counts duplicates as errors instead of "skipped."

---

## 3. Security posture (live advisor scan + shared-layer audit)

**Good news:** the Supabase RLS posture is solid — every one of the ~120 `commander_*` tables has RLS enabled with policies, except `commander_admin_pins` (RLS on, 0 policies = deny-all to non-service-role, which is the safe default for an admin-PIN table). The only ERROR-level RLS advisories are `spatial_ref_sys` (PostGIS system table) and `player_stats_snapshots` (not a Commander table). Commander's two SECURITY DEFINER functions (`has_commander_access`, `get_commander_access_details`) are expected auth helpers.

**Application-layer weaknesses to address (flagged, not silently changed):**
- **Plaintext PINs** — `commander_staff.pin_code` is stored/compared in plaintext (`verifyPin` does an equality lookup). Should be hashed (bcrypt/argon2) with a constant-time compare.
- **Rate limiting is decorative on Vercel** — `apiRateLimit` is in-memory per-lambda-instance (resets on cold start, N instances = N× budget) and the Bearer branch trusts an *unverified* JWT `sub`. For auth/PIN endpoints, move to a shared store (Upstash/Postgres) and verify the JWT before trusting `sub`. (The signed-staff-session bucket is done correctly.)
- **Vendor `auth.js` still ships pre-hardening guards** — it accepts an *unsigned* `x-staff-session` JSON (forgeable) and the owner path has no TTL. Currently latent (API routes import the hardened `src/lib/commander/auth.js`), but any future import of the package path reintroduces forgery. Harden or delete the vendor copy.
- **`guardWriteStaff` leaves GETs public** — read protection is per-route on the honor system; a few pages rely on this.
- **supabaseServerClient JWT fallback** accepts a *revoked* token until its `exp` (it fires even when GoTrue actively rejects, not just on network failure).
- **XSS in print windows** — daily-summary and W-2G print popups interpolate `player_name`/notes into `document.write` unescaped (low severity, staff-controlled).
- **CI/build**: `typescript.ignoreBuildErrors:true` ships type errors; `@supabase/ssr:"latest"` is unpinned; `manual-deploy.yml` interpolates a dispatch input into a shell `run` (injection, low severity).

**Structural risk — vendoring drift:** `src/lib/**` and `src/components/**` are mostly re-export shims into `vendor/commander-shared`, but vendor components import *package-internal* copies of libs — so a fix in a `src/` override never reaches the pages. Both P0/P1 shared-layer bugs this round had that exact root cause. Recommend a CI diff of the 5 real overrides (auth, apiRateLimit, icm-utils, useClubBranding, supabase) against their vendor counterparts, or fix-in-vendor-only.

---

## 4. TableCaptain comparison — updated verdict after the audit

The audit **confirms the earlier conclusion and strengthens it**: as a *venue-side* poker-room management system, Club Commander is now broader and, after this round, more correct than anything TableCaptain publicly documents. Every one of TableCaptain's 12 official modules has a working Commander counterpart, and Commander adds entire categories TableCaptain has nothing for (time-billing, escrow home games, AI wait-time/table-balance/churn, streaming, leagues/squads, a full social layer, responsible-gaming, GTO training, global multi-venue profiles).

What the audit changes in the parity picture:
- **Realtime is now genuinely cross-device** (P0 fix) — previously Commander's live sync only worked within one browser, which was arguably *behind* TableCaptain's core "broadcast live to every device" promise. That gap is closed.
- The remaining true gap is unchanged and is **not** a venue-software gap — it's the **consumer live layer** (publishing games-in-progress, live waitlists with numbered positions, remote sign-up, and live tournament clocks to player-facing smarter.poker pages). All the data exists in Supabase; this is a publish/UI build, tracked as P0 in the parity master list (`.agent/audits/2026-08-04-tablecaptain-parity-master-list.md`).
- The stubs in §2 (close-day persistence, time-billing session UI, marketplace booking, venue-settings save) are places where Commander's UI over-promises vs. its backend — worth finishing to claim "everything works," but none are things TableCaptain does better; they're half-built Commander extras.

Bottom line for "1:1 but better": venue-side is at parity-plus and now correct on realtime; to fully surpass TableCaptain the priority remains the consumer live layer (their only real moat), followed by finishing the §2 stubs and the §3 security hardening.

---

## 5. Verification
- Build: passed with all ~40 commits; Vercel deployment `dpl_6dnNrxL1...` READY, target production.
- Production `commander.smarter.poker/api/health` serves HEAD `d1933d97`.
- Vendor `supabase.js` on main confirmed to hold the real-client fix; anon key confirmed present in the shipped client bundle → fix is effective, not inert.
- Migrations #24, #25 (+ prior #26/#27, equipment, templates, pause-billing) confirmed applied via `list_migrations`/`information_schema`.
- No tournament-create regression: CreateTournamentModal always submits a non-empty blind structure and no payout_structure, so it passes the new create validation.
