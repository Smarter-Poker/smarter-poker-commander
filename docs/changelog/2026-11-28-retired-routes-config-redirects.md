# Retired staff screens become server redirects (2026-11-28)

## What changed

Four staff screens were retired on 2026-08-20 and kept as client-side
redirect pages (`RetiredRoute`) so floor-tablet bookmarks would not 404
mid-event:

| Retired URL | Now redirects to |
|---|---|
| `/commander/tournament-clocks` | `/commander/displays` |
| `/commander/tournament-registration` | `/commander/tournament-controls` |
| `/commander/tournaments/[id]` | `/commander/td/[id]` |
| `/commander/tournaments/[id]/break-manager` | `/commander/td/[id]/tables` |

Each still shipped a page bundle, rendered a "This Screen Has Moved" card
before a client `router.replace`, held a #SmarterDesign image header entry and
an app-root header slot. The bookmarks are now honoured by `next.config.js`
`redirects()` as temporary (307) server redirects, before any page renders,
with the query string passed through. The four page files and the
`RetiredRoute` component (used by nothing else) are deleted.

The `?id`-less fallback the pages had (`/commander/tournament-controls`) was
unreachable: a `[id]` route always has an id.

Retirement notes (what replaced what, what was ported before retirement) are
in the git history of the deleted files at 2fa3c31.

## Also updated

- `pages/_app.js`: four entries removed from
  `COMMANDER_ROUTES_WITHOUT_SHARED_LAYOUT` (29 -> 25).
- `src/components/commander/shared/pageHeaders.js`: four registry entries
  removed.
- `tests/integrity/global-header.test.mjs`: page count 113 -> 109.
- `tests/integrity/sign-out-contract.test.mjs`: message count 29 -> 25.

## Regression protection

`tests/unit/retiredRoutes.law.test.js` (vitest, in `npm test`): each rule
exists with the right destination and `permanent: false`, the page files stay
deleted, no registry or app-root entry remains, and no tournament redirect
uses a catch-all pattern that would swallow the live
`/commander/tournaments/[id]/{clock-display,public,seating-display,settings,structure-display}`
screens.
