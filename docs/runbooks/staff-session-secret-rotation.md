# Runbook: rotating the staff-session signing secret

The `x-staff-session` token every Commander API call carries is
HMAC-SHA256-signed with `COMMANDER_STAFF_SESSION_SECRET` (falling back to
`SUPABASE_JWT_SECRET`, then `SUPABASE_SERVICE_ROLE_KEY` - see
`src/lib/commander/auth.js`). Changing the effective value invalidates every
signature in circulation at once.

## What happens to users when it rotates

| Who | Before 2026-09-03 | Now |
|---|---|---|
| Owners / managers (Supabase-authenticated) | Every API 401'd -> "Your Session Is Not Valid" -> login page that could not complete. Platform-wide lockout. | `commanderFetch` re-mints the session from the live Supabase token on the first 401 and retries. **Invisible** to the user. |
| PIN terminals on the floor (no Supabase user) | 401 until someone re-enters a PIN | Same. A PIN session cannot be re-minted without the PIN. **This is the only human cost of a rotation.** |

## Procedure

1. Pick a low-traffic window for the venues' floors (PIN terminals will need a
   PIN re-entry).
2. Set `COMMANDER_STAFF_SESSION_SECRET` in Vercel (smarter-poker-commander,
   **Production**). Generate with `openssl rand -hex 32`. Never reuse the
   service-role key.
3. Redeploy (any commit to `main`, or "Redeploy" in Vercel).
4. Verify: `node scripts/probe-login-bridge.mjs` with `PROBE_EMAIL`/`PROBE_PASSWORD`
   set. The `guarded API accepts the signed session (200)` row proves the new
   secret signs and verifies; `rejects a hand-edited session (401)` proves the
   old value is gone.
5. Tell the floors to re-enter their PINs once.
6. Do **not** remove `SUPABASE_JWT_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` from
   the environment as "cleanup": the first is a fallback, the second is used by
   every admin query.

## Migrating from the fallback chain (first-time setup)

If `COMMANDER_STAFF_SESSION_SECRET` is not set yet (health endpoint:
`auth.dedicated_staff_session_secret: false`), set it to the **current** value
of `SUPABASE_JWT_SECRET` first. Same value = same signatures = zero
invalidation. Rotate to a fresh value later, using the procedure above.

## What NOT to do

- Do not "fix" a rotation by disabling signature verification, even briefly.
  Unsigned sessions are forgeable owner sessions (2026-07-25 audit P0).
- Do not extend the 24h owner TTL (48h renew window) to avoid re-mints.
  Re-minting is silent now - `/api/staff-session/renew` re-signs an authentic
  session without a DB lookup, and check-subscription covers the rest - so
  the TTL only bounds the damage of a leaked token.
