# Design: one session for smarter.poker and commander.smarter.poker

**Status: DESIGNED, NOT BUILT.** This is the one item from the 2026-09-03
hardening pass that is deliberately a document rather than code, and this file
says why and exactly what to build when it is time.

## Today

Both apps keep the Supabase session in `localStorage['smarter-poker-auth']`.
localStorage is origin-scoped, so `smarter.poker` and `commander.smarter.poker`
hold **two independent copies**, kept in step by a one-time-token SSO dance
(`/api/auth/commander-sso` -> `/auth/sso` -> `sso-exchange` -> `verifyOtp`).
It works, it is now tested end to end, and it self-heals - but it is ~400
lines of code whose only purpose is to copy a session across a dot.

## Target

A single Supabase session cookie with `Domain=.smarter.poker`, read by both
apps and by every API route. No SSO token table, no `/auth/sso`, no bridge.
"Continue As Smarter.Poker" becomes "you are already in".

## Why it is not a hotfix

- The hub has 300+ API routes. The local commander `getUser()` is Bearer-first
  with a cookie fallback, but the hub's `getServerUserWithFallback` and the
  vendored `auth.js` `getUser()` are **cookie-only via auth-helpers**, while
  every client sends **Bearer from localStorage**. Flipping storage to cookies
  changes which of those paths is live on every route at once.
- `@supabase/ssr` cookie storage chunks the session across several cookies
  (`sb-<ref>-auth-token.0`, `.1`, ...). Anything that reads the raw
  localStorage blob today (`clientAuth.getToken`, `readAccessToken`, the
  header avatar cache, Club Arena's shared session) needs a second read path.
- The hourly :55 platform freeze and Club Arena's `smarter-poker-auth`
  contract are downstream of the hub's storage key. Changing the key is a
  platform change, not a Commander change.

## Build plan (when scheduled)

1. **Hub**: create the browser client with `@supabase/ssr` `createBrowserClient`,
   cookie options `{ domain: '.smarter.poker', sameSite: 'lax', secure: true }`.
   Keep writing `localStorage['smarter-poker-auth']` as a **mirror** for one
   release (Club Arena and the header cache read it).
2. **Hub API**: `getServerUserWithFallback` reads Bearer first, cookie second
   (it is the same order the commander override uses). Add a unit test per
   path.
3. **Commander**: same browser client config; `readAccessToken()` /
   `clientAuth.getToken()` gain a cookie read path; middleware gains a real
   cookie check **inside `src/lib/commander/auth.js`**, never a second client.
4. **Soak** one week with both storages live. The login-bridge probe gets a
   third leg: sign in on the hub, open the commander dashboard with cookies
   only, expect no bridge hop.
5. **Retire** `/auth/sso`, `sso-exchange`, `commander-sso`,
   `sso_bridge_tokens`, and the `?bridge=1` path. Update the law test in the
   same PR (pins 5 and the SSO contract rows become obsolete by design).
6. **Delete** the localStorage mirror once Club Arena reads cookies.

Estimated effort: 3-4 focused days across hub + commander + club-arena, plus
the soak. Do it as its own programme with its own handoff doc, not as a side
quest inside an unrelated PR.
