/**
 * GET /api/desktop-release  (also /api/commander/desktop-release via the
 * rewrite in next.config.js, which is what the page calls)
 *
 * The latest published Club Commander Desktop release as a download catalog,
 * read from GitHub. Public data, no auth. Changelog:
 * docs/changelog/2026-11-28-desktop-downloads-follow-the-release.md
 */
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';
import { getLatestDesktopRelease } from '../../src/lib/commander/desktopReleaseSource';
import { RELEASES_PAGE_URL } from '../../src/lib/commander/desktopRelease';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const { catalog, stale, error } = await getLatestDesktopRelease();
    if (!catalog) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ available: false, releasesUrl: RELEASES_PAGE_URL, error });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).json({ available: true, stale, releasesUrl: RELEASES_PAGE_URL, release: catalog });
  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    if (!res.headersSent) return res.status(500).json({ available: false, releasesUrl: RELEASES_PAGE_URL, error: 'Internal server error' });
  }
}
