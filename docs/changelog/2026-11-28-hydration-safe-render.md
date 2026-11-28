# 2026-11-28 - Server and first client render match (React #425 / #423)

Backlog item 4 of the Commander #SMARTERDESIGN programme.

## The defect, reproduced

Production build + `next start`, headless Chrome with a seeded staff session,
every one of the 108 Commander routes, console and page errors captured:
on main (ef73838) **52 routes threw React #425** ("Text content does not
match server-rendered HTML") followed by #423 (React discards the server HTML
and re-renders the whole root on the client), 121 hydration errors in all
(some with #418 too).

Two causes (dev-mode diffs named both):

1. **`<style>{`css`}</style>`**. React escapes text children on the server, so
   `font-family: 'Orbitron'` leaves as `&#x27;Orbitron&#x27;` and `a > b` as
   `a &gt; b`. The browser parses `<style>` as raw text and keeps the entities,
   so the client text never matches. 60 such elements in 59 files under
   `pages/` and `src/`, and 6 in vendored commander-shared, including
   `CommanderLayout.jsx`, which every staff page renders.
2. **Wall clocks from `useState(new Date())`** (and `{new Date().toLocale...}`
   in JSX): read on the server, then in the browser seconds later
   ("1:46:07 AM" vs "1:46:08 AM"). Display boards, lobby, player and tablet
   screens, seating/structure displays, floor, close day, shift handoff.

## The fix, at the source

- `src/components/commander/shared/InlineStyle.jsx`: writes CSS as inner HTML
  (same bytes from server and client), with `</style` neutralised. Every
  `<style>{...}</style>` in `pages/` and `src/` now uses it (three empty ones
  removed).
- `src/hooks/useClientNow.js`: `[now, setNow]` that is `null` on the server and
  the first client render, set right after mount (optional interval), plus
  `formatClientTime / formatClientDate / formatClientDateTime`, which print a
  stable placeholder until then. 18 pages moved from `useState(new Date())` /
  `useState(Date.now())`; close day and shift handoff no longer call
  `new Date()` in JSX; the leaderboard board's subtitle reads the date inside
  its fetch.

## Result (same harness, same 108 routes)

- main ef73838: 52 routes, 121 errors.
- this change: 48 routes, 104 errors. Lobby, player screen, seating display
  and structure display are clean. **Every remaining route renders the
  vendored `CommanderLayout`**, whose `<style>{`...`}</style>` (`'Orbitron'`
  in the global header CSS) is the first mismatch React reports on each.

## Not done here, and why

The six vendored files (`CommanderLayout.jsx`, `CommanderEffectsProvider.jsx`,
`DealerTicker.jsx`, `FloorCallAlert.js`, `ArenaLedger.jsx`, `SkeletonDark.jsx`)
need the same one-line change (`<style dangerouslySetInnerHTML={{ __html: ... }} />`
or an InlineStyle in commander-shared). Law 3.5 requires that upstream first in
`Smarter-Poker/commander-shared`, then a sync; that repo and `vendor/` were
outside this worker's assignment. The law test holds those six as a ratchet
that may only shrink.

Staff-gated date state left as is (never server-rendered: the page renders
nothing until the browser-only staff session loads):
`tournament-maintenance.js` `currentMonth`, `reports/tax-compliance.js`
`year`, `reports/daily-summary.js` `date`.

## Regression protection

`tests/unit/hydrationSafeRender.law.test.js` (vitest, `npm test`): InlineStyle
server-renders CSS byte for byte and cannot be closed early; useClientNow
server-renders the placeholder; no `<style>{` text child in `pages/` or `src/`;
vendored ones only shrink; no clock read into `useState`; no
`{new Date().toLocale...}` or `now.toLocale...()` in render; the 13 clock pages
use useClientNow.
