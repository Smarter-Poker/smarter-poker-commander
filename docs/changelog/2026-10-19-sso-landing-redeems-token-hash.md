# 2026-10-19: "Continue As Smarter.Poker" redeems the magic link as a token hash

**What users saw.** Signed in on smarter.poker, pressing "Continue As
Smarter.Poker" on the Commander login went to the hub, came back to
`/auth/sso` and stopped on "Sign-In Failed - Failed to restore session.
Please sign in manually." Password sign-in kept working.

**Why.** `/api/auth/sso-exchange` returns the `token` query parameter of
generateLink's `action_link`, which is the HASHED magic-link token.
`pages/auth/sso.js` passed it to `verifyOtp({ email, token, type })`, the shape
for the 6-digit email code, so Supabase hashed it again, matched nothing and
answered `403 otp_expired` ("Token has expired or is invalid"). Read from the
Playwright trace of Login Bridge Probe run 39333867218: the exchange returned
200, the `/auth/v1/verify` call returned 403 `otp_expired`.

The browser hop test was added on 2026-09-04 17:13 UTC and failed on every run
since (chromium, webkit, mobile Safari). The API leg of the probe stayed green
because it stopped at "the exchange returned a payload" and never redeemed it.
The probe account's credentials were fine throughout: its password grant,
signed staff session and renewal all passed on every run.

**Fix.** `/auth/sso` calls `verifyOtp({ token_hash, type })`. The probe's
signed-in leg now redeems the exchanged token the same way, so the Open Claw
probe and the 30-minute workflow both fail if the redemption breaks again.
`tests/unit/loginBridge.law.test.js` pin 5b fails against the old call.
