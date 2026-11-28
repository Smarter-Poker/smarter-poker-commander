# #SmarterDesign polish: PIN gate Title Case, content frame, readable dense pages (2026-11-28)

Backlog item 6 of the Club Commander #SmarterDesign programme.

## 1. PIN gate copy in Title Case

`vendor/commander-shared/src/components/commander/shared/CommanderLayout.jsx`:
"ACCESS RESTRICTED" -> "Access Restricted"; subtitle and the seven fixed
`setPinError` messages to Title Case (e.g. "Enter At Least 4 Digits",
"Verification Failed - Try Again"). Landed upstream first:
Smarter-Poker/commander-shared#91 (aa08179). The vendored hunk is
byte-identical to upstream; the file as a whole stays on the vendor
divergence baseline for its pre-existing, unrelated #ClubButtons drift (no
new divergence; `node scripts/check-vendor-upstream-sync.mjs` passes).

## 2. Page content shares the image header's frame

The image header sits in a 1600px wrap with a `clamp(8px, 2vw, 24px)`
gutter. Page content did whatever each page chose: full-bleed (168-184px
wider than the header on each side at 1920px) or a centred column 160-536px
narrower on each side. `styles/commander-smarterdesign.css` now gives every
page root that follows `[data-page-image-header]` the header's outer edges
(`margin-inline: max(gutter, (100% - 1600px) / 2 + gutter)`, new
`--cmd-sd-gutter`), and lets page-level columns fill it: `max-w-4xl..7xl`
and inline 900-1400px columns anywhere, `max-w-lg..3xl` and inline
600-800px columns within three levels of the page root. Cards and empty
states (`max-w-sm`/`md`), fixed overlays and dialogs are untouched. One rule
in the shared skin, no page edits.

Measured on a local production build (Playwright, all registry routes): at
1920px, 57 of the 61 header routes with measurable content now have content
edges within the page's own 0-32px inner padding of the header edges (before:
0 of 57; every one off by 50px or more, up to 536px on centred columns and
168-184px outside the header on full-bleed pages). Remaining by design: time-clock (a 384px punch card), docs
(asymmetric index), qr-code (48px own padding), tournament-maintenance (empty
state). The schedule grid's horizontal scroll at 393px is unchanged
(pre-existing, now starts at the header edge).

## 3. Readable text on Comps, Floor Calls, Incidents

No text under 12px on `pages/commander/comps.js`, `floor-calls.js`,
`incidents.js`: badges, pills, uppercase field labels and meta captions
10/11px -> 12px; body copy (category descriptions, explanatory lines, call
descriptions, footnotes, amounts) -> 13px.

## Regression protection

`tests/unit/smarterdesignPolish.law.test.js` (vitest, in `npm test`; 10 of
11 fail on the previous code): PIN gate Title Case (title, subtitle, every
fixed error), the header frame and content frame rules (gutter, 1600px calc,
column classes, dialog/fixed exclusions, sm/md untouched), nothing under 12px
on the three dense pages and their body copy at 13px or larger.
