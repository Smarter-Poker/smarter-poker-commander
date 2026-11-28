# Vendored commander-shared: CSS as inner HTML, zero hydration errors (2026-11-28)

Follow-up to #170 (hydration-safe render). After #170, 48 of 52 measured
routes still logged React #425 / #423, all from six vendored commander-shared
components that wrote `<style>{`css`}</style>` (React escapes the text child
on the server; the browser keeps the entities inside `<style>`; the client
text never matches, React re-renders the whole root).

Fixed upstream first (CLAUDE.md law 3.5): Smarter-Poker/commander-shared#92,
merged 1aaa984, then synced here:

- `ArenaLedger.jsx`, `CommanderEffectsProvider.jsx`, `DealerTicker.jsx`,
  `FloorCallAlert.js`, `ui/SkeletonDark.jsx`: byte-identical to upstream.
  DealerTicker, FloorCallAlert and SkeletonDark were on the divergence
  baseline only for the em dashes this copy had already removed; upstream
  took this copy's text, so their three baseline entries are deleted
  (`scripts/ci/vendor-upstream-divergence.json` 51 -> 48; the ratchet only
  shrinks).
- `CommanderLayout.jsx`: the same one-hunk change as upstream; the file stays
  on the baseline for its pre-existing, unrelated #ClubButtons drift.

`tests/unit/hydrationSafeRender.law.test.js`: the vendored allowlist
(`VENDOR_STYLE_TEXT_DEBT`) is now empty and the test requires the vendored
tree to have no `<style>{` text child at all.

Measured: production build + `next start` + headless Chrome over all 108
Commander routes (owner session seeded, the same harness #170 used): 0 pages
with hydration errors, 0 errors (before this change: 48 pages, 104 errors).
