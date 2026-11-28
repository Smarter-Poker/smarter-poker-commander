# 2026-11-28 - Colour settings can only hold approved #SMARTERDESIGN colours

Backlog item 2 of the Commander #SMARTERDESIGN programme (PR #166 follow-up).

## The defect

PR #166 moved every colour written in source to the #SMARTERDESIGN tokens, but
four editors still offered the browser's free colour wheel:

- Clock Setup: the four theme colours and every chip denomination colour
  (`pages/commander/clock-setup.js`)
- Game Types: the game colour (`pages/commander/game-types.js`)
- Waitlist Desk: the six desk theme colours, plus a free hex text box
  (`pages/commander/waitlist/desk.js`)

and the boards painted whatever had been saved (desk + waitlist TV board,
tournament clock display, game type list, Cashier membership tiers). One click
on the wheel, or any value saved before the migration, put yellow, gold,
purple or pink back on a TV board. Two starter clock themes were themselves
purple and gold ("Royal Purple", "Gold Elite").

## The fix, at the source

1. `src/lib/commander/sdPalette.js` - `SD_SWATCHES` (22 approved colours:
   white, frost, silver, steel, slate, ice, cyan, sky, light blue, azure,
   cobalt, royal blue, deep cobalt, deep blue, midnight, surface, ink, black,
   plus semantic green / felt green / red / deep red; values from
   `styles/smarterdesign.css` and the targets of
   `scripts/smarterdesign-palette.mjs`) and `normalizeSdColor()`. A banned hue
   (by HSL: 33-72 deg yellow/gold/amber/orange-gold, 250-345 deg
   purple/violet/magenta/pink, pale 235-250 deg lavender, pale 345-360 deg
   pink; greys and near-black/white carry no hue) becomes the approved blue
   nearest in perceived lightness (CIE L*), keeping alpha. Everything else
   passes through unchanged.
2. `src/components/commander/shared/SdSwatchPicker.jsx` - the only colour
   control: real `<button type="button">`s, 44px targets, accessible names
   ("Accent: Cobalt"), `aria-pressed`, the chosen colour's Title Case name
   shown under the group. Replaces all four colour wheels and the desk's free
   hex box.
3. Every read of a saved colour goes through the normaliser at the point the
   page takes it in: desk and waitlist TV board (`desk_customization`), clock
   setup and clock display (`normalizeClockPreset`: theme + chip colours),
   game types, Cashier membership tier colours.
4. Every API that stores a colour normalises it on write
   (`pages/api/settings.js`, `clock-presets.js`, `game-types.js`,
   `membership-plans.js`), so a stored value can only be approved from now on.
   No data was rewritten: an older banned value renders in-palette and is
   replaced the next time staff save that setting.
5. Defaults are swatches so the picker shows them chosen: desk/board bar
   background `#040D18`, player text `#F2F7FF`, borders `#445E77` (were
   #050505 / #E0E0E0 / #666666); chip defaults green / black / cobalt /
   white / red / ice; starter themes "Royal Blue" and "Ice Elite" replace the
   purple and gold ones; game presets Mixed / Big O / Short Deck moved to
   azure / ice / royal blue. Desk label "Accent / Gold" is now "Accent".

## Regression protection

`tests/unit/sdColorPickers.law.test.js` (vitest, runs in `npm test`):
no `type="color"` anywhere in `pages/`, `src/` or vendored commander-shared;
every swatch valid, Title Case and not banned; 33 real banned values map to
approved swatches; approved and unrelated colours pass through; each editor
renders SdSwatchPicker; every page that reads `desk_customization`, clock
presets, game type or plan colours normalises them; every API write
normalises; desk and board defaults match and are swatches; no starter theme
is purple or gold.

## Verification

- Production build + `next start`, headless Chrome with a seeded staff
  session: Clock Setup editor 10 swatch groups (4 theme + 6 chips, 220
  buttons, defaults shown pressed), Game Types form 1 group, Desk
  Customization 6 groups; 0 colour inputs; every button 44x44.
- Legacy data: with `desk_customization` served as gold header, gold
  accent, purple bar background and violet borders, neither
  `/commander/waitlist/desk` nor `/commander/displays/waitlist` paints any of
  those colours (computed styles scanned); the accent renders as ice.
