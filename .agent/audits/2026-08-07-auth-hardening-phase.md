# Auth Hardening Phase — 2026-08-07

Everything below was verified against production, not inferred. Where a claim was
tested, the measurement is quoted.

---

## 1. Staff PINs were stored in plaintext

`commander_staff.pin_code` held plaintext and the terminal login route compared it
with a plain equality filter.

Now: bcrypt hashes in `pin_hash`, verified via `fn_verify_staff_pin` (hash first,
legacy-plaintext fallback so nobody could be locked out mid-migration), and a
BEFORE INSERT/UPDATE trigger (`fn_commander_staff_hash_pin`) that hashes the
submitted PIN and **blanks the plaintext in the same statement** — so no code path
can reintroduce an unhashed PIN. Plaintext readers were removed first: the
duplicate-PIN checks in `staff/index.js` and `staff/[id].js` now use
`fn_staff_pin_taken`.

Verified: 24 staff rows, **0 plaintext**, 24 hashed; production login succeeds with
a signed session; wrong PIN and wrong-venue both rejected.

### Two traps found by testing, not by reading
- **bcrypt cost 10 cost 827ms per login.** PIN-only auth (venue + pin -> staff) has
  no unique identifier to index on, so the RPC must bcrypt every active staff row
  at the venue. 12 staff = 827ms, scaling linearly (a 40-staff room > 2.5s). Cost 6
  brings a full-venue scan to ~119ms. PINs are 4-6 digits, so a high cost buys
  little against offline cracking anyway; the real protections are not leaking the
  table and throttling online attempts (section 2).
- **The first cutover hardened a function with no callers.** `verifyPin` was
  re-exported from the shared package, but the actual staff terminal login route
  (`pages/api/staff/verify-pin.js`) never called it — it ran its own inline
  plaintext query. Always confirm the route that actually authenticates.

---

## 2. Rate limiting did not work, then still did not work

The login route documented "5 attempts per minute per IP, lockout after 10
failures" but enforced it in a per-process `Map`. On Vercel every lambda instance
keeps its own Map and it resets on deploy.

**Measured before the fix: 14 consecutive wrong PINs, all HTTP 200, zero lockouts.**

Fix 1 — durable shared counter in Postgres (`commander_rate_limits`, which already
existed with the right unique index but had never been written to) via
`fn_rate_limit_hit`, using `SELECT ... FOR UPDATE` so concurrent lambdas count
correctly.

**Re-measured: the burst still sailed through.** The limiter was working perfectly;
the attempts arrived from a rotating pool of egress IPs
(`160.79.106.128/129/131/138/139`), so each IP had its own counter and none reached
the threshold. **Per-IP throttling alone does not stop a distributed attack** — any
attacker with a few proxies gets the same result.

Fix 2 — also throttle on the dimension the attacker cannot rotate: the venue whose
PINs are being guessed. Three deliberate choices:
- only **failures** count, so a busy room's successful logins never trip it;
- the threshold is generous (25 failures / 5 min, 2 min lockout) so an attacker
  cannot cheaply lock a poker room's staff out;
- the pre-check **peeks without incrementing** (`fn_rate_limit_blocked`), so
  checking can never contribute to the lockout.

Verified in production: distributed burst blocked at attempt 27, per-IP layer also
firing at 32, and — the counter-check that mattered — **legitimate staff login
recovered cleanly once the 2-minute lockout expired**. It is a throttle, not a
denial-of-service lever.

Both limiter calls fail **open** on RPC error: PIN verification depends on the same
database, so failing closed would lock out all staff without adding protection. The
`console.warn` strings (`rate limiter unavailable`, `venue lockout check
unavailable`, `venue failure counter unavailable`) are the hooks to alert on.

---

## 3. Shared vendor auth accepted unsigned sessions

`vendor/commander-shared/src/lib/commander/auth.js` `verifyStaffSession` went
straight from `JSON.parse(x-staff-session)` into the staff lookup with **no
signature check** — so any caller could forge a staff identity by sending a staff
row id, or an owner identity with a `user_id` + `venue_id` + `role: 'owner'`
triple. Its TTL check was also conditional (`if (sessionData.session_ts)`), so
omitting that field removed expiry too.

Latent, not live: verified that World Hub has **zero** API routes importing these
guards and that the Commander app imports its hardened local
`src/lib/commander/auth.js`. Both repos carried the identical vulnerable blob
(`5b8c449…`) and now carry the identical hardened blob (`b302d3c…`).

Fixed by adding the same HMAC gate the hardened copy uses, failing closed. This is
compatible with real traffic because every issuer signs sessions at creation, so
verification rejects only forgeries. Unit-tested: legitimate session verifies;
unsigned, tampered-id, **role-escalated-to-owner**, venue-swapped, and
garbage-signature sessions are all rejected.

---

## 4. Checked and found already correct (no change made)

- **Admin PIN** (`pages/api/admin/pin-verify.js`): JWT-gated, PIN salted with the
  user id and hashed, and lockout handled durably inside
  `verify_commander_admin_pin` (fail counter in Postgres, 15-min lock, reset on
  success). Only drift: the route comment says "5 fails", the RPC locks at 10.
  Consider bcrypt over SHA-256 there eventually — lower priority, since the table
  is service-role-only and online attempts are locked out.
- **Generic `applyRateLimit`** (`src/lib/apiRateLimit.js`, a local override): already
  fixes the JWT-header-bytes bug, prefers the non-spoofable `x-real-ip`, and always
  enforces the IP bucket so an attacker cannot mint a fresh bucket per request with
  a random Bearer. It is still in-memory per-lambda, which is acceptable
  best-effort abuse throttling for non-auth endpoints; converting every write
  endpoint to a DB round-trip would cost more than it buys. Auth endpoints are the
  ones that needed durable limits, and they have them.

---

## 5. Still open

- `commander_staff.pin_code` column still exists (always NULL now) as a rollback
  shim. Dropping it is a trivial follow-up.
- No CI guard against vendoring drift. `src/lib/**` are mostly re-export shims into
  `vendor/commander-shared`, but a handful are real local overrides (auth,
  apiRateLimit, icm-utils, useClubBranding, supabase, home-games/rpcBridge). A fix
  applied to an override never reaches code that imports the vendor path — that is
  exactly how the vendor auth copy stayed forgeable while the app copy was hardened.
  A CI check diffing the overrides against their vendor counterparts would close the
  class.
