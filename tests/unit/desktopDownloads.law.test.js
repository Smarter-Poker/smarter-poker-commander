/**
 * THE DOWNLOADS PAGE NEVER NAMES A VERSION (2026-11-28)
 *
 * /commander/downloads and /api/download hardcoded tag v1.0.6 and the 1.0.5
 * file names, so every desktop release left them offering an old build. They
 * now read the latest published release (src/lib/commander/desktopRelease.js).
 * This law keeps version-bearing file names and pinned tags out of both, and
 * keeps the page on the release API.
 * Changelog: docs/changelog/2026-11-28-desktop-downloads-follow-the-release.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = ['pages/commander/downloads.js', 'pages/api/download.js', 'pages/api/desktop-release.js'];

describe('desktop downloads follow the release', () => {
  it('no hardcoded version, tag or installer file name', () => {
    for (const f of FILES) {
      const src = code(f);
      expect(src, f).not.toMatch(/\d+\.\d+\.\d+/);
      expect(src, f).not.toMatch(/['"`]v\d+/);
      expect(src, f).not.toMatch(/\.(exe|dmg|AppImage|deb)['"`]/i);
      expect(src, f).not.toMatch(/Club[.-]Commander[.-]/);
      expect(src, f).not.toMatch(/releases\/download\//);
    }
  });

  it('the page reads the release API and offers the releases page when it cannot', () => {
    const page = code('pages/commander/downloads.js');
    expect(page).toMatch(/fetch\('\/api\/commander\/desktop-release'/);
    expect(page).toMatch(/Downloads Unavailable, Try Again/);
    expect(page).toMatch(/onClick=\{load\}/);
    expect(page).toMatch(/href=\{RELEASES_PAGE_URL\}/);
    expect(page).not.toMatch(/\/api\/commander\/download\?platform/);
  });

  it('both routes resolve through the one source and cache at the CDN', () => {
    for (const f of ['pages/api/download.js', 'pages/api/desktop-release.js']) {
      const src = code(f);
      expect(src, f).toMatch(/getLatestDesktopRelease\(\)/);
      expect(src, f).toMatch(/s-maxage=600/);
    }
    expect(code('src/lib/commander/desktopReleaseSource.js')).toMatch(/LATEST_RELEASE_API_URL/);
    expect(code('src/lib/commander/desktopRelease.js')).toMatch(/api\.github\.com\/repos\/\$\{DESKTOP_REPO\}\/releases\/latest/);
  });
});
