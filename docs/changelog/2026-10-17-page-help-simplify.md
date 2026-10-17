# Page Titles And Descriptions Move Behind A "?" (Dan, 2026-10-17)

Owner instruction: "PAGES DON'T NEED TITLES LIKE THIS... REMOVE ALL DESCRIPTIONS THAT EXIST LIKE THIS ON ANY AND ALL PAGES. ADD A ? MARK ICON INSTEAD IN THE UPPER RIGHT CORNER OF THE PAGES THAT CAN EXPLAIN ANYTHING AND ALSO LAUNCH A TUTORIAL AT THE BOTTOM WHEN CLICKED."

## What Changed

- New `src/components/commander/shared/PageHelp.jsx`: a 44px circular "?" (aria-label "Page Help") that opens a bottom docked, non-modal panel. Step 0 "About This Page" shows the page title and the description the header used to print; Start Tutorial walks curated steps (or steps built from the page's section headings), lighting each target with a 2px #1877F2 outline. Escape, Done, Got It, Close and a route change close it; focus returns to the button.
- New `src/components/commander/shared/PageBar.jsx`: the slim bar that replaces a page header. Visually hidden h1, live status and the page's own buttons on the left, the "?" pinned top right even when the row wraps.
- 62 staff pages lose their visible title, describing sentence and decorative icon box. Every action button, live count, venue or tournament name, step counter, range label and pill stays.
- `ArenaLedger` and `ExportManager` (shared package) changed upstream first and synced byte-identical. ArenaLedger leaves the vendor divergence ratchet (52 to 51 entries).
- `tests/unit/pageHelp.law.test.js` pins the component contract, the help on every simplified page and the removal of each old description (81 of its 88 assertions fail on the previous main).

## Not Changed

Public marketing and sales pages, `docs/`, the admin PIN gate, TV and public display screens, kiosk steps and player-facing screens keep their words: they are read by players on TVs and kiosks, or they are the explanation.

## Order

`Smarter-Poker/commander-shared` branch `claude/page-help-simplify-2026-10-17` merges first, then this branch (the ratchet check reads upstream main).
