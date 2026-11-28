# 2026-11-27 - Commander stays signed in, and its header matches the hub

Dan: "CLUB COMMANDER IS STILL DOING THAT WEIRD THING WHERE ITS MAKING YOU LOG IN
AGAIN WHEN YOU CLICK TO OPEN IT ... HARD CODE FIX THIS AT ITS ROOT CAUSE", then
"IT ALSO NEEDS TO SYNC WITH THE GLOBAL HEADER ... ITS NOT PULLING THE PROFILE
IMAGE, AND ITS NOT DISPLAYED CORRECTLY".

## Root causes

1. **The hub card never ran the SSO hop.** World Hub `src/world/WorldHub.tsx`
   read `localStorage['smarter-poker-auth'].session.access_token`; supabase-js
   v2 stores the session flat, so the token was always undefined and every
   click went straight to `commander.smarter.poker/commander/login`.
   Fixed in World Hub (`src/lib/commander/openClubCommander.js`, SDK session).
2. **The login page waited for a click.** With no platform session in this
   origin's localStorage (first visit, cleared storage, Safari eviction, an
   expired refresh token), `/commander/login` showed the password form even
   though the hub still held the session. It now takes the hub hop itself,
   once per two minutes per tab (`autoBridgeThroughHub`, sessionStorage loop
   breaker), on the plain path and on `?expired=1`. An explicit Sign Out
   returns before it, so it never bridges a user back in.
3. **The header guessed the photo.** Both headers read browser storage; the
   hub's `sp-cached-header-user` is never written on this origin, so a Google
   account's `user_metadata.avatar_url` (Google's letter tile) won. They now
   use `useHeaderPortrait` (commander-shared #89): the profiles row with the
   hub's `resolveHeaderPortrait` rule, default avatar otherwise.
4. **The header frame differed.** Same artwork file as the hub, but a 58% x .78
   oval slot inside the visible chrome ring. Now the hub geometry: black disc
   over the ornament, 72% round slot, 0.5px hairline.

## Pins

- `tests/unit/loginBridge.law.test.js` - auto-bridge pin.
- `tests/e2e/login-bridge.spec.ts` - signed-in-on-hub reaches the dashboard
  with no click; signed-out still ends on the form (no loop).
- `tests/integrity/global-header.test.mjs` - geometry and photo source.
