# Busiest staff screens load 2-2.5x lighter

Date: 2026-11-28 (Central)
Scope: Club Commander `/commander/tables`, `/commander/waitlist/desk`,
`/commander/cashier`, `/commander/dashboard`, first load of `/commander/login`
(and, through the shared layout and header, every staff page). No behaviour
change: every page still draws its image header and one help.

## How it was measured

- `next build` First Load JS per route (gzip kB, as Next prints it).
- Lab metrics with Playwright + Chrome against `next start`, mocked APIs,
  cold cache, median of 3 runs, mobile profile: 393x860 at DPR 2.75, CPU 4x
  slowdown, network 150 ms RTT / 1.6 Mbps down / 750 kbps up (Lighthouse
  "Slow 4G" values applied as real DevTools throttling). Transfer = every
  non-API byte; LCP from PerformanceObserver; TBT = long-task time over 50 ms
  after FCP; script = CDP ScriptDuration. Login is measured as the sign-in page
  itself (the one-time bounce to the hub origin skipped).
  Tool: `/home/claude/perf-evidence/tools/perf.cjs`.
- Before = main at 664fd64, after = this change, both built and measured in
  the same session.

## What cost the most, and the fix at its source

1. **Node `crypto` in the browser on every CommanderLayout page (125 kB).**
   The vendored `CommanderLayout` imported `canRoleAccessRoute` /
   `isSensitiveRoute` from `lib/commander/auth.js`, the server auth module. That
   pulled `crypto` (webpack's crypto-browserify polyfill: 325 KB raw / 100 kB
   gzip), `@supabase/auth-helpers-nextjs` and the service-role client factory
   into the client. The role and route tables now live in the pure
   `lib/commander/roleAccess.js` (no imports; landed upstream first in
   Smarter-Poker/commander-shared), `auth.js` re-exports them unchanged, the
   layout and the Dashboard import the pure module (`src/lib/commander/roleAccess.js`
   shim). 84 routes lost 125 kB of First Load JS on average.
2. **The global header art was a 302 KB PNG on every page.** It is now a
   `<picture>` with WebP sources (824w 16 KB, 1648w 41 KB, quality 90, visually
   identical at 2x zoom) and the same PNG as the fallback `<img>`, in both
   owners (vendored `CommanderLayout`, `StandaloneGlobalHeader`). Geometry,
   disc and hairline unchanged (`display: contents` on the picture).
3. **The default portrait was a 976x1024 JPEG (147 KB)** loaded on every page
   before the real photo resolves, drawn 17-110 px wide. Same file name and
   format, resized to 256x269: 15 KB.
4. **The login background, the sign-in page's largest paint, was a 253 KB
   JPEG.** Now WebP (45 KB) with the JPEG as fallback, same box.
5. **Header scenes shipped up to 1170 px (75-110 KB) to phones** that draw them
   ~215 CSS px wide. The 47 scenes wider than 760 px now have a 640 px copy
   (`<art>-scene-640.webp`, 35 KB smaller on average) offered through
   `srcSet`/`sizes` (`headerSceneVariants.js`); desktops still take the original.

Not changed: Supabase JS (~70 kB of `_app`) is needed by the session on every
page, the 17 kB shared CSS is the #SmarterDesign palette.

## Before / after

First Load JS (`next build`, kB):

| Route | Before | After |
|---|---|---|
| /commander/tables | 321.2 | 196.3 |
| /commander/waitlist/desk | 189.6 | 190.0 |
| /commander/cashier | 328.7 | 203.7 |
| /commander/dashboard | 320.2 | 195.2 |
| /commander/login | 164.4 | 164.8 |

(The Waitlist Desk and Login do not use CommanderLayout; +0.4 kB is the scene
list in `_app`.)

Lab, mobile Slow 4G, median of 3 (transfer / JS / images in KB, times in ms):

| Route | Transfer | JS | Images | LCP | TBT | Load |
|---|---|---|---|---|---|---|
| tables | 913 -> 404 | 323 -> 200 | 571 -> 184 | 4040 -> 3044 | 159 -> 101 | 2265 -> 1603 |
| waitlist/desk | 720 -> 334 | 196 -> 196 | 503 -> 117 | 1280 -> 1188 | 32 -> 28 | 3955 -> 2150 |
| cashier | 913 -> 361 | 331 -> 208 | 559 -> 130 | 5916 -> 4336 | 147 -> 135 | 4898 -> 2030 |
| dashboard | 925 -> 370 | 322 -> 199 | 584 -> 152 | 4648 -> 3904 | 146 -> 110 | 2256 -> 1630 |
| login (sign-in page) | 997 -> 404 | 224 -> 225 | 695 -> 102 | 5324 -> 2572 | 25 -> 55 | 5298 -> 1727 |

Script execution time moved within run-to-run noise (the polyfill was
downloaded and parsed but little of it ran); TBT readings on this shared
2-CPU sandbox vary by about +-40 ms. The remaining LCP on the layout pages is
bound by the client-rendered layout (the server sends the loading state), not
by bytes.

## Guards

- `scripts/check-first-load-budget.mjs`, run by the required `build` job
  after `npm run build`: First Load JS of the five routes may not exceed
  `scripts/ci/first-load-budget.json` by more than 5%, and no client chunk may
  contain the crypto-browserify polyfill. On main before this change it fails
  tables, cashier, dashboard and the polyfill chunk.
- `tests/unit/staffScreensSpeed.law.test.js`: roleAccess is pure and
  re-exported, no page or client component imports `lib/commander/auth`, the
  header and login art are WebP with the original as fallback, the default
  portrait stays small, every wide scene has its 640 px copy and the list
  matches the files, the budget arithmetic matches `next build`.
- `tests/e2e/staff-headers.spec.ts` and `tests/unit/staffHeadersCensus.law.test.js`
  read SENSITIVE_ROUTES from `roleAccess.js` now (one path each).
- `scripts/ci/vendor-upstream-divergence.json`: the CommanderLayout entry
  records the WebP `<picture>` as vendor-only (the hub has no WebP copy of
  the art, so upstream keeps the PNG).

Evidence: `/home/claude/perf-evidence/{before,after}/` (build logs,
manifests, metrics) and `/home/claude/perf-evidence/shots/` (each route at
393 and 1280 before and after: same header, same help).
