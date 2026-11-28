/**
 * GET /api/download?platform=<key>  (also /api/commander/download via the
 * rewrite in next.config.js)
 *
 * Redirects to the matching file in the LATEST published Club Commander
 * Desktop release. Until 2026-11-28 this route pinned tag v1.0.6 and the 1.0.5
 * file names, so it could only ever serve that build. Keys are unchanged for
 * existing links: win-setup, win-portable, mac-dmg, mac-zip, linux-appimage,
 * linux-deb. When GitHub cannot be read, or the release has no such file, it
 * redirects to the releases page instead of a dead link.
 * Changelog: docs/changelog/2026-11-28-desktop-downloads-follow-the-release.md
 */
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';
import { getLatestDesktopRelease } from '../../src/lib/commander/desktopReleaseSource';
import { LEGACY_PLATFORM_KEYS, RELEASES_PAGE_URL, pickDownload } from '../../src/lib/commander/desktopRelease';

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const { platform } = req.query;
    if (!platform || !LEGACY_PLATFORM_KEYS.includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform', valid: LEGACY_PLATFORM_KEYS });
    }

    const { catalog } = await getLatestDesktopRelease();
    const pick = pickDownload(catalog, platform);
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.redirect(302, pick ? pick.url : RELEASES_PAGE_URL);
  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    if (!res.headersSent) return res.redirect(302, RELEASES_PAGE_URL);
  }
}
