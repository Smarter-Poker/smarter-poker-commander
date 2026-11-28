/**
 * Club Commander Desktop downloads, read from the latest PUBLISHED release of
 * Smarter-Poker/club-commander-desktop (2026-11-28).
 *
 * Changelog: docs/changelog/2026-11-28-desktop-downloads-follow-the-release.md
 *
 * Before this, /commander/downloads and /api/download hardcoded tag v1.0.6 and
 * the 1.0.5 file names, so every desktop release left the page offering an old
 * build (and a renamed asset would have 404'd). The page and the redirect now
 * derive everything from the release itself.
 *
 * This module is pure: it turns GitHub's release JSON into a catalog. The
 * network read and its cache live in desktopReleaseSource.js.
 *
 * Asset names it understands, by release:
 *   1.0.x published (GitHub rewrote spaces to dots):
 *     Club.Commander.Setup.1.0.5.exe        Windows installer
 *     Club.Commander.1.0.5.exe              Windows portable
 *     Club.Commander-1.0.5-arm64.dmg        macOS disk image, Apple Silicon
 *     Club.Commander-1.0.5-arm64-mac.zip    macOS ZIP, Apple Silicon
 *     Club.Commander-1.0.5.AppImage         Linux AppImage
 *     club-commander_1.0.5_amd64.deb        Debian package
 *   1.0.x drafts (electron-builder's own upload, spaces to dashes):
 *     Club-Commander-Setup-1.0.5.exe, Club-Commander-1.0.5.exe, ...
 *   1.1.0 onward (electron-builder.yml artifactName, no spaces):
 *     Club-Commander-Setup-1.1.0.exe        Windows installer (x64 + ia32)
 *     Club-Commander-Portable-1.1.0.exe     Windows portable
 *     Club-Commander-1.1.0-arm64.dmg / -x64.dmg
 *     Club-Commander-1.1.0-arm64.zip / -x64.zip
 *     Club-Commander-1.1.0-x86_64.AppImage
 *     club-commander_1.1.0_amd64.deb
 * Update metadata (latest*.yml) and .blockmap files are not downloads.
 */

export const DESKTOP_REPO = 'Smarter-Poker/club-commander-desktop';
export const RELEASES_PAGE_URL = `https://github.com/${DESKTOP_REPO}/releases`;
export const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${DESKTOP_REPO}/releases/download/`;

export const PLATFORMS = ['windows', 'mac', 'linux'];

const ARCH_LABEL = { arm64: 'Apple Silicon', x64: 'Intel' };

// Order inside a platform: the first entry is the primary download.
const KIND_ORDER = { 'win-setup': 0, 'win-portable': 1, 'mac-dmg': 2, 'mac-zip': 3, 'linux-appimage': 4, 'linux-deb': 5 };

function detectArch(lower) {
  if (/(^|[^a-z0-9])(arm64|aarch64)([^a-z0-9]|$)/.test(lower)) return 'arm64';
  if (/(^|[^a-z0-9])(x64|x86_64|amd64|intel)([^a-z0-9]|$)/.test(lower)) return 'x64';
  if (/(^|[^a-z0-9])(ia32|x86|i386)([^a-z0-9]|$)/.test(lower)) return 'ia32';
  if (/(^|[^a-z0-9])universal([^a-z0-9]|$)/.test(lower)) return 'universal';
  return null;
}

/** The version embedded in a file name (1.0.5 in "Club.Commander.Setup.1.0.5.exe"). */
export function fileVersion(name) {
  const m = String(name || '').match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

/**
 * One release asset file name to { kind, platform, arch } or null when it is
 * not something a person downloads.
 */
export function classifyAsset(name) {
  if (typeof name !== 'string' || name.trim() === '') return null;
  const lower = name.toLowerCase();
  if (lower.endsWith('.blockmap') || lower.endsWith('.yml') || lower.endsWith('.yaml') || lower.endsWith('.sig') || lower.endsWith('.sha256')) return null;
  const arch = detectArch(lower);

  if (lower.endsWith('.exe') || lower.endsWith('.msi')) {
    // "Setup" names the installer in every scheme; "Portable" names the
    // portable build from 1.1.0, and before that it was the unmarked .exe.
    const kind = /(^|[^a-z])setup([^a-z]|$)/.test(lower) || lower.endsWith('.msi') ? 'win-setup' : 'win-portable';
    return { kind, platform: 'windows', arch: arch || 'x64' };
  }
  if (lower.endsWith('.dmg')) return { kind: 'mac-dmg', platform: 'mac', arch: arch || 'x64' };
  if (lower.endsWith('.zip')) return { kind: 'mac-zip', platform: 'mac', arch: arch || 'x64' };
  if (lower.endsWith('.appimage')) return { kind: 'linux-appimage', platform: 'linux', arch: arch || 'x64' };
  if (lower.endsWith('.deb')) return { kind: 'linux-deb', platform: 'linux', arch: arch || 'x64' };
  return null;
}

function labelFor(kind, arch, archCountForKind) {
  const archText = arch && ARCH_LABEL[arch] && archCountForKind > 1 ? ` (${ARCH_LABEL[arch]})` : '';
  switch (kind) {
    case 'win-setup': return 'Windows Installer';
    case 'win-portable': return 'Windows Portable';
    case 'mac-dmg': return `macOS Disk Image${archText}`;
    case 'mac-zip': return `macOS ZIP Archive${archText}`;
    case 'linux-appimage': return 'Linux AppImage';
    case 'linux-deb': return 'Debian Package';
    default: return 'Download';
  }
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function isReleaseDownloadUrl(url) {
  return typeof url === 'string' && url.startsWith(DOWNLOAD_PREFIX) && !/\s/.test(url);
}

/**
 * GitHub release JSON to the catalog the page and the redirect use.
 * Returns null when the release has nothing downloadable.
 */
export function buildDesktopCatalog(release) {
  if (!release || typeof release !== 'object' || release.draft || release.prerelease) return null;
  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  const assets = Array.isArray(release.assets) ? release.assets : [];

  const downloads = [];
  for (const asset of assets) {
    if (!asset || (asset.state !== undefined && asset.state !== 'uploaded')) continue;
    const info = classifyAsset(asset.name);
    if (!info || !isReleaseDownloadUrl(asset.browser_download_url)) continue;
    downloads.push({
      kind: info.kind,
      platform: info.platform,
      arch: info.arch,
      fileName: asset.name,
      fileVersion: fileVersion(asset.name),
      size: Number(asset.size) || 0,
      sizeLabel: formatBytes(asset.size),
      url: asset.browser_download_url,
    });
  }
  if (downloads.length === 0) return null;

  const platforms = { windows: [], mac: [], linux: [] };
  for (const d of downloads) {
    const sameKind = downloads.filter((o) => o.kind === d.kind).length;
    platforms[d.platform].push({ ...d, label: labelFor(d.kind, d.arch, sameKind) });
  }
  const archRank = { arm64: 0, x64: 1, universal: 2, ia32: 3 };
  for (const p of PLATFORMS) {
    platforms[p].sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || ((archRank[a.arch] ?? 9) - (archRank[b.arch] ?? 9)));
  }
  const macArches = [...new Set(platforms.mac.map((d) => d.arch))];

  return {
    tag,
    version: tag.replace(/^v/i, '') || null,
    name: typeof release.name === 'string' && release.name ? release.name : tag,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
    releaseUrl: typeof release.html_url === 'string' && release.html_url.startsWith(RELEASES_PAGE_URL) ? release.html_url : RELEASES_PAGE_URL,
    macArches,
    platforms,
  };
}

/**
 * The old /api/download?platform=<key> keys, resolved against a catalog.
 * mac-dmg / mac-zip prefer Apple Silicon (what the keys always meant), then
 * whatever exists.
 */
export const LEGACY_PLATFORM_KEYS = ['win-setup', 'win-portable', 'mac-dmg', 'mac-zip', 'linux-appimage', 'linux-deb'];

export function pickDownload(catalog, key) {
  if (!catalog || !LEGACY_PLATFORM_KEYS.includes(key)) return null;
  const all = PLATFORMS.flatMap((p) => catalog.platforms[p] || []);
  const matches = all.filter((d) => d.kind === key);
  if (matches.length === 0) return null;
  return matches.find((d) => d.arch === 'arm64') || matches.find((d) => d.arch === 'x64') || matches[0];
}

/** Which tab to open first, from a browser user agent. */
export function platformFromUserAgent(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (/iphone|ipad|android/.test(ua)) return 'windows';
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'windows';
}
