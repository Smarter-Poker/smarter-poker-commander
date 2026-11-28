# Desktop downloads follow the latest release (2026-11-28)

## What was wrong
`/commander/downloads` hardcoded tag `v1.0.6`, the 1.0.5 file names and their sizes,
and `pages/api/download.js` (reached as `/api/commander/download?platform=...` through
the rewrite in `next.config.js`) pinned the same tag and names. Every desktop release
therefore left the page and the redirect offering an old build, and any renamed asset
would have become a dead link. Club Commander Desktop 1.1.0 renames every asset
(`Club-Commander-Setup-1.1.0.exe`, `Club-Commander-1.1.0-arm64.dmg`, ...), so the next
release would have broken all six links.

## What changed
- `src/lib/commander/desktopRelease.js` (pure): maps GitHub release assets to
  platform/kind/arch for every naming scheme the desktop repo has used (1.0.x published
  dot names, 1.0.x draft dash names, 1.1.0 names), drops `latest*.yml` and `.blockmap`,
  accepts only `https://github.com/Smarter-Poker/club-commander-desktop/releases/download/`
  URLs, and labels both Mac chips when a release carries both.
- `src/lib/commander/desktopReleaseSource.js`: reads
  `https://api.github.com/repos/Smarter-Poker/club-commander-desktop/releases/latest`
  unauthenticated, 5 s timeout, 10-minute per-instance cache, last good answer served
  as stale for up to a day when GitHub fails or rate-limits.
- `pages/api/desktop-release.js` (new, public): the catalog as JSON, CDN-cached 10
  minutes; 503 with the releases page URL when nothing can be read.
- `pages/api/download.js`: the same keys (`win-setup`, `win-portable`, `mac-dmg`,
  `mac-zip`, `linux-appimage`, `linux-deb`) now redirect to the file in the latest
  release, or to the releases page instead of a dead link.
- `pages/commander/downloads.js`: shows the release version, date (Central), file names
  and sizes from the API; direct download links; a "Downloads Unavailable, Try Again"
  state with Try Again and Open Releases Page; Mac requirements follow the chips the
  release actually contains.

## Tests
- `tests/unit/desktopRelease.test.js`: mapper against the live v1.0.6 asset list, the
  1.0.x draft names and the 1.1.0 names; legacy keys; cache, rate limit and stale paths.
- `tests/unit/desktopDownloads.law.test.js`: no version, tag or installer file name in
  the page or either route; the page reads the release API and offers the releases page.
