/**
 * Server-side read of the latest published Club Commander Desktop release.
 * Changelog: docs/changelog/2026-11-28-desktop-downloads-follow-the-release.md
 *
 * Public data, read unauthenticated from the GitHub API (60 requests per hour
 * per IP). Each server instance keeps the answer for 10 minutes, and the
 * routes also set a 10-minute CDN cache, so the API sees a handful of requests
 * an hour. When GitHub fails or rate-limits, the last good catalog is served
 * (stale: true) for up to a day; with nothing cached the caller gets null and
 * shows "Downloads Unavailable".
 */
import { buildDesktopCatalog, LATEST_RELEASE_API_URL } from './desktopRelease';

export const CACHE_TTL_MS = 10 * 60 * 1000;
export const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

let cache = { at: 0, catalog: null };

export function __resetDesktopReleaseCache() {
  cache = { at: 0, catalog: null };
}

/**
 * @returns {Promise<{ catalog: object|null, stale: boolean, error: string|null }>}
 */
export async function getLatestDesktopRelease({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const t = now();
  if (cache.catalog && t - cache.at < CACHE_TTL_MS) return { catalog: cache.catalog, stale: false, error: null };

  let error = null;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetchImpl(LATEST_RELEASE_API_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'smarter-poker-commander' },
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res || !res.ok) {
      error = `GitHub answered ${res ? res.status : 'nothing'}`;
    } else {
      const catalog = buildDesktopCatalog(await res.json());
      if (catalog) {
        cache = { at: t, catalog };
        return { catalog, stale: false, error: null };
      }
      error = 'The latest release has no downloadable files';
    }
  } catch (err) {
    error = (err && err.name === 'AbortError') ? 'GitHub did not answer in time' : String((err && err.message) || err);
  }

  if (cache.catalog && t - cache.at < STALE_LIMIT_MS) return { catalog: cache.catalog, stale: true, error };
  return { catalog: null, stale: false, error };
}
