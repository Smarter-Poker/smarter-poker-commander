# Table seat badges scale with the table and never overlap on phones

Date: 2026-11-28 (Central)
Scope: Club Commander table views (Tables, Table Tablets, dealer tablet,
Waitlist Desk Seat Player picker, TV table board)

## Why

On the Club Arena table skin (#174), every view still sized its seat badges in
fixed pixels (52-60px avatars, 13-15px names, 110-140px name boxes, 17px side
offsets) while the table shrank with the screen. On a 375-430px phone the seat
box is about 300-380px wide, and nine full-size badges overlapped one another
and the dealer.

## What changed

- `src/components/commander/shared/ClubArenaTable.jsx`:
  - `SEAT_BOX_CLASS` / `SEAT_BOX_STYLE`: the square seat box is a CSS size
    container (`container-type: inline-size`).
  - `seatScale(ref)`: returns `px -> clamp(min, px/ref of the box in cqw, px)`.
    `ref` is the box width each view has on a 1280px desktop, so every badge is
    its old size there and shrinks with the table below that.
  - `seatClass(leftPct, extra)`: `ca-seat` plus `--left` / `--right` /
    `--dealer`.
  - A compact layout (rendered once per table through `InlineStyle`, so it
    hydrates cleanly) for seat boxes under 520px: avatar over a short name,
    ellipsis on long names, secondary text (timers, "Tap To Seat", chip
    counts, membership tier, "Dealer" / "Tap To Scan") hidden, side seats
    pulled inward so they stay inside the table, the dealer lifted clear of the
    frame, and the centre text scaled down.
- All five views mark their seat box, every seat, dealer, avatar, name and
  secondary line with those classes, and size them through `sp(...)`. No seat
  badge dimension is a fixed pixel number any more. Seat clicks, moves,
  scanner, Seat Player assignment and status colours are unchanged.
- Table Tablets: the two-column grid table reaches full size at a 760px box
  (it is 590px on a 1280px desktop, where the old full-size badges already
  overlapped: Sam Rivera over Chris Park, dealer over seat 1). The card grid
  uses `minmax(min(400px, 100%), 1fr)`, so it no longer runs off the right
  edge of a phone. Remaining emoji in seat labels were replaced, and the labels
  were Title Cased ("Paused", "Meal Break", "Move Here", "Tap To Seat",
  "Tap To Confirm", "h Balance").
- Dealer tablet: ticker emoji removed; "Welcome To ...".
- TV table board: the frame is a little taller (52% -> 56%, offset -24% ->
  -22%) so the compact dealer never clips.

## Law

`tests/unit/clubArenaTableSkin.law.test.js` now also requires, for every view:
a `seatScale` ref, the seat box container, no `translate(-Npx` or
`calc(-100% + Npx)` offsets, and no fixed-pixel `width / height / fontSize /
minWidth / maxWidth / gap / borderRadius / padding` on any element carrying a
seat class. Dealer pucks must take a scaled size. The skin module must keep
`seatScale`, the container, the `@container` compact rules and the ellipsis
rule.

## Verified

Production build + `next start`, seeded staff session, mocked tables / waitlist
/ tablet data. Playwright measured every pair of seat and dealer badges in
every seat box at 375, 393, 430, 560, 640, 768, 1024 and 1280px: 0 overlaps,
0 badges clipped by the frame. Seat Player assignment still posts
`/api/commander/waitlist/seat` at every width. React hydration errors: 0 in
two unmocked runs and in three mocked runs on this build.
