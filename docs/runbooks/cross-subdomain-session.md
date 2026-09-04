# Design: one session for smarter.poker and commander.smarter.poker

**Status: DESIGNED, NOT BUILT - DECIDED 2026-09-04, see the decision at the
end.** This is the one item from the 2026-09-03 hardening pass that is
deliberately a document rather than code, and this file says why and exactly
what to build when it is time.

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

## Decision (2026-09-04): not now, and here is what would change that

Re-examined at the end of the hardening programme with the option of building
it. The answer is no, for reasons that are about risk and ownership, not effort:

1. **The hop it removes is now the best-watched path on the platform.** The
   login bridge is probed hourly from Hetzner (Open Claw) and every 30 minutes
   from GitHub, both legs, with a Sentry event and a self-closing issue on
   failure; a real browser runs it end to end; the derived staff session lasts
   24 h and renews without a database read for 48 h; and a stale one self-heals
   before any banner shows. The remaining cost of the hop is one redirect on
   the first visit per browser. There is no user-visible defect left for the
   cookie to fix.
2. **It is a hub-wide storage flip, not a commander change.** Every hub API
   route, the header avatar cache, Club Arena's `smarter-poker-auth` contract
   and the :55 freeze tooling read the localStorage key today. The hub
   CLAUDE.md classifies auth changes as Tier 3 (plan, Dan approves, then
   build). Doing it as a side effect of "harden the login bridge" is the exact
   pattern that file forbids.
3. **Refresh-token rotation is a real hazard in the shared design.** Supabase
   rotates the refresh token on every refresh and treats reuse outside a short
   grace window as theft (the whole session family is revoked). Two apps
   holding one cookie is fine when the same storage adapter does the
   refreshing; two apps with two clients each racing to refresh the same
   token is how a user gets signed out of everything at once. The build plan
   above handles it (one adapter, one client config), but it has to be built
   and soaked as one programme, never half-migrated.

**What would reopen it** (any one of these):

- the probe or Sentry shows the SSO hop itself failing (rows "hub mints a
  one-time SSO token" / "sso-exchange returns the OTP payload") more than once
  a month for a reason that is not a deploy race;
- the hub adopts `@supabase/ssr` cookie sessions for its own reasons, at which
  point steps 3-6 of the build plan are a two-day commander change;
- a third app on a `*.smarter.poker` origin needs the same session, so the hop
  would have to be duplicated.

Until then this file is the plan and the law test keeps the hop honest.
Owner of the decision to build: Dan (Tier 3). Owner of this record: whoever
next touches the login bridge - update the "what would reopen it" list rather
than deleting it.
