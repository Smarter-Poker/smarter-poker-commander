# Commander table views draw the Club Arena table skin

Date: 2026-11-28 (Central)
Scope: Club Commander staff app, #SmarterDesign programme

## Why

World Hub `docs/SMARTERDESIGN.md` requires every poker table workspace to
render the authentic Club Arena / Poker Arena table skin, room background and
Arena dealer button. Five Commander views still drew the retired black-and-gold
table photo `public/images/poker-table-black-gold.png`: Tables, Table Tablets,
the dealer tablet (`/commander/tablet/[tableNumber]`), the Waitlist Desk seat
picker and the TV table board (`/commander/displays/tables`).

## What changed

- New `src/components/commander/shared/ClubArenaTable.jsx`: the felt
  (`<ClubArenaTableFelt />`), the room (`clubArenaRoomStyle()`) and the Arena
  classic-white dealer puck (`clubArenaDealerPuckStyle()`).
- Look: Club Arena's free "Ocean Suite" preset - `ocean_blue` felt with its
  cyan rail light and the classic-white dealer button - in the `ocean_abyss`
  room (Ocean Suite's own `royal_indigo` room is purple and gold, which
  #SmarterDesign bans). Room layers follow Arena `resolveBackgroundLayersForUrl`
  (ambience over art over an always-paints CSS floor).
- Assets (new, `public/images/club-arena-table/`):
  - `ocean-blue-felt-landscape.webp` (999x580, 50 KB) from
    `club-arena/src/assets/tables/skin_ocean_blue.png` (current Arena copy,
    newer than World Hub's `public/hub/table-theme/tables/skin_ocean_blue.png`),
    cropped to its painted edge and turned on its side for the landscape
    floor view.
  - `ocean-abyss-room.webp` (720x1280, 28 KB) from
    `club-arena/src/assets/backgrounds/bg_ocean_abyss.jpg` (byte-identical to
    World Hub's `public/hub/table-theme/backgrounds/bg_ocean_abyss.jpg`).
  - Both are imported, so their URLs carry the production `assetPrefix` and
    load on commander.smarter.poker and on the proxied smarter.poker/commander.
- The felt fills the same square seat box and oval the photo did, so seat
  positions, numbers, names, status colours, timers and every interaction
  (seat clicks, move, scan, Waitlist Desk open-seat assignment) are unchanged;
  the felt takes no pointer events.
- Dealer markers in all five views are the Arena puck. The dealer tablet keeps
  the dealer's photo when one exists, and its frame is a little taller so the
  puck and the dealer's name are no longer cut off at the bottom.
- Waitlist Desk seat picker now uses the same cropped-square geometry as the
  other views (it had stretched seats over a 5:3 box around a small square
  photo).
- `displays/tables.js`: pictographic emoji replaced with lucide icons or plain
  Title Case text (lock, unlock, people, chair, scanner, camera, pause/meal
  labels, toasts); a few labels Title Cased ("Tap To Scan", "Tap To Lock",
  "Seated", "Open", "Tap An Open Seat To Assign").
- `public/images/poker-table-black-gold.png` deleted (no Commander reference
  remains). World Hub ships its own copy for its own social/club surfaces;
  that is a separate repo and was not touched.

## Law

`tests/unit/clubArenaTableSkin.law.test.js`: no `poker-table-black-gold`
anywhere in pages/src/styles/vendor/public and the file is gone; each of the
five views imports and renders the felt, room and puck; the skin module imports
both assets and paints the Arena puck with no pointer events; both assets exist
as WebP under 200 KB.

## Verified

Production build + `next start` with seeded staff session and mocked table,
waitlist and tablet data; screenshots of all five views at 1280px and 393px;
clicking an open seat in the Waitlist Desk picker posts
`/api/commander/waitlist/seat`. Gates: `npm test`, `npm run test:global-header`,
vendor upstream sync, palette `--check`.
