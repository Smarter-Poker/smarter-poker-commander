# 2026-11-27 - Club Commander on #SMARTERDESIGN, every page

Dan: "CLUB COMMANDER NEEDS THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE
PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE, EXACTLY LIKE WE'VE DONE FOR EVERY
OTHER WORLD HUB PAGE... MAKE ANY AND ALL OPTIMIZATIONS, ENHANCEMENTS, UPGRADES
AND SIMPLIFICATIONS NOW."

Standard: World Hub `docs/SMARTERDESIGN.md` (same primitives, same chrome).

## What changed, at the source

1. **Colours** - `scripts/smarterdesign-palette.mjs` moved every colour from
   the Facebook dark palette (#18191A / #242526 / #3A3B3C, accent #1877F2) to
   the #SMARTERDESIGN tokens, per use (background / border / text), in 198
   files here and 60 in commander-shared (#90, same script, so vendored copies
   stay identical). It removed every prohibited hue: amber, gold, goldenrod,
   purple, violet, indigo, pink, magenta (694 amber uses alone).
2. **Material** - `styles/smarterdesign.css` (World Hub's primitives) plus
   `styles/commander-smarterdesign.css`: one continuous steel rim per surface
   (nested surfaces get a hairline), cobalt bevels on primary actions, the
   chrome row on secondary actions and chips, cobalt for the selected tab,
   ink inputs with an ice focus, Rajdhani titles, the PIN gate and dialogs.
   Inline-styled controls are covered too (both serialised style forms).
3. **Image headers** - `CommanderImageHeader` on all 89 staff pages
   (`pageHeaders.js` registry: title, parent, seal + scene from the World Hub
   library; the Cashier gets Club Arena's Cashier vault, the reference).
   CommanderLayout renders it through commander-shared's new `PageHeaderSlot`;
   the standalone staff routes get it from `_app`. The page's own PageHelp /
   PageBar hands its title, summary and tutorial to the header's one painted
   chrome "?" (`PageHelpHost`), so no page shows two. Wall displays, kiosks,
   table tablets, public tournament screens and sign-in stay headerless.

## Painted-image UI replaced with real controls

The old "bulky frame" style (text baked into pictures, invisible hotspots):

- Dashboard: six painted console cards + painted icon tiles -> six
  steel-rimmed sections with seals and 64 live feature buttons on one screen
  (old `?card=` links scroll to their section). Painted upgrade modal -> a
  real dialog.
- Cashier: painted metal action panel + painted Print New Card -> real
  buttons, same handlers.
- Membership Plans: the whole page was a mockup image with prices floated
  over Y-percent zones -> real plan rows with the same inline price editor.
- Player Kiosk: painted Welcome frame -> real Check In / Join Waitlist /
  New Member buttons.
- Club Page popup and PIN gate restyled.

## Checked

Production build; `npm test` (lint:undef, vitest 324, auth 39); vendor gate
PASSED; local production render of every registry route at 1280px and key
routes at 393px (65 render their header with exactly one "?", the rest are
retired redirects, the admin PIN entry or the PIN gate). Pre-existing, not
from this change: React hydration warnings (#425/#423) on pages that render
the time, and `/commander/members/[id]` throwing when the member does not
load - both reproduce on untouched main.

Pinned by `tests/unit/smarterdesign.law.test.js`.
