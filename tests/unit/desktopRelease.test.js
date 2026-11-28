/**
 * Desktop downloads follow the latest published release (2026-11-28).
 * Changelog: docs/changelog/2026-11-28-desktop-downloads-follow-the-release.md
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyAsset, buildDesktopCatalog, pickDownload, fileVersion, formatBytes,
  platformFromUserAgent, RELEASES_PAGE_URL, LEGACY_PLATFORM_KEYS,
} from '../../src/lib/commander/desktopRelease';
import {
  getLatestDesktopRelease, __resetDesktopReleaseCache, CACHE_TTL_MS, STALE_LIMIT_MS,
} from '../../src/lib/commander/desktopReleaseSource';

const DL = 'https://github.com/Smarter-Poker/club-commander-desktop/releases/download';
const asset = (tag, name, size = 1000) => ({ name, size, state: 'uploaded', browser_download_url: `${DL}/${tag}/${name}` });

// The published v1.0.6 release exactly as GitHub returns it today.
const V106 = {
  tag_name: 'v1.0.6', name: 'v1.0.6', draft: false, prerelease: false,
  published_at: '2026-02-10T04:08:06Z',
  html_url: 'https://github.com/Smarter-Poker/club-commander-desktop/releases/tag/v1.0.6',
  assets: [
    asset('v1.0.6', 'club-commander_1.0.5_amd64.deb', 75062300),
    asset('v1.0.6', 'Club.Commander-1.0.5-arm64-mac.zip', 93803826),
    asset('v1.0.6', 'Club.Commander-1.0.5-arm64.dmg', 98063200),
    asset('v1.0.6', 'Club.Commander-1.0.5.AppImage', 107010271),
    asset('v1.0.6', 'Club.Commander.1.0.5.exe', 78238911),
    asset('v1.0.6', 'Club.Commander.Setup.1.0.5.exe', 78538076),
  ],
};

// The 1.0.x drafts electron-builder uploaded itself (dash names + metadata).
const DRAFT_NAMES = [
  'Club-Commander-1.0.5-arm64-mac.zip', 'Club-Commander-1.0.5-arm64.dmg', 'Club-Commander-1.0.5-arm64.dmg.blockmap',
  'Club-Commander-1.0.5.AppImage', 'Club-Commander-1.0.5.exe', 'Club-Commander-Setup-1.0.5.exe',
  'Club-Commander-Setup-1.0.5.exe.blockmap', 'club-commander_1.0.5_amd64.deb',
  'Club.Commander-1.0.5-arm64-mac.zip.blockmap', 'latest-linux.yml', 'latest-mac.yml', 'latest.yml',
];

// 1.1.0 onward (club-commander-desktop electron-builder.yml artifactName).
const V110 = {
  tag_name: 'v1.1.0', name: 'v1.1.0', draft: false, prerelease: false,
  published_at: '2026-11-28T12:00:00Z',
  html_url: 'https://github.com/Smarter-Poker/club-commander-desktop/releases/tag/v1.1.0',
  assets: [
    'Club-Commander-Setup-1.1.0.exe', 'Club-Commander-Setup-1.1.0.exe.blockmap', 'Club-Commander-Portable-1.1.0.exe',
    'Club-Commander-1.1.0-arm64.dmg', 'Club-Commander-1.1.0-x64.dmg', 'Club-Commander-1.1.0-arm64.dmg.blockmap',
    'Club-Commander-1.1.0-arm64.zip', 'Club-Commander-1.1.0-x64.zip', 'Club-Commander-1.1.0-x64.zip.blockmap',
    'Club-Commander-1.1.0-x86_64.AppImage', 'club-commander_1.1.0_amd64.deb',
    'latest.yml', 'latest-mac.yml', 'latest-linux.yml',
  ].map((n) => asset('v1.1.0', n, 100 * 1024 * 1024)),
};

describe('classifyAsset: every naming scheme the desktop repo has used', () => {
  it('1.0.x published names (dots)', () => {
    expect(classifyAsset('Club.Commander.Setup.1.0.5.exe')).toEqual({ kind: 'win-setup', platform: 'windows', arch: 'x64' });
    expect(classifyAsset('Club.Commander.1.0.5.exe')).toEqual({ kind: 'win-portable', platform: 'windows', arch: 'x64' });
    expect(classifyAsset('Club.Commander-1.0.5-arm64.dmg')).toEqual({ kind: 'mac-dmg', platform: 'mac', arch: 'arm64' });
    expect(classifyAsset('Club.Commander-1.0.5-arm64-mac.zip')).toEqual({ kind: 'mac-zip', platform: 'mac', arch: 'arm64' });
    expect(classifyAsset('Club.Commander-1.0.5.AppImage')).toEqual({ kind: 'linux-appimage', platform: 'linux', arch: 'x64' });
    expect(classifyAsset('club-commander_1.0.5_amd64.deb')).toEqual({ kind: 'linux-deb', platform: 'linux', arch: 'x64' });
  });

  it('1.0.x draft names (dashes) and update metadata', () => {
    const kinds = DRAFT_NAMES.map((n) => classifyAsset(n)?.kind ?? null);
    expect(kinds).toEqual(['mac-zip', 'mac-dmg', null, 'linux-appimage', 'win-portable', 'win-setup', null, 'linux-deb', null, null, null, null]);
  });

  it('1.1.0 names', () => {
    expect(classifyAsset('Club-Commander-Setup-1.1.0.exe').kind).toBe('win-setup');
    expect(classifyAsset('Club-Commander-Portable-1.1.0.exe').kind).toBe('win-portable');
    expect(classifyAsset('Club-Commander-1.1.0-x64.dmg')).toEqual({ kind: 'mac-dmg', platform: 'mac', arch: 'x64' });
    expect(classifyAsset('Club-Commander-1.1.0-arm64.zip')).toEqual({ kind: 'mac-zip', platform: 'mac', arch: 'arm64' });
    expect(classifyAsset('Club-Commander-1.1.0-x86_64.AppImage')).toEqual({ kind: 'linux-appimage', platform: 'linux', arch: 'x64' });
    expect(classifyAsset('club-commander_1.1.0_amd64.deb').kind).toBe('linux-deb');
  });

  it('ignores blockmaps, update metadata and junk', () => {
    for (const n of ['latest.yml', 'latest-mac.yml', 'x.exe.blockmap', 'notes.txt', '', null, undefined]) {
      expect(classifyAsset(n)).toBeNull();
    }
  });

  it('reads the version out of file names', () => {
    expect(fileVersion('Club.Commander.Setup.1.0.5.exe')).toBe('1.0.5');
    expect(fileVersion('Club-Commander-1.1.0-x86_64.AppImage')).toBe('1.1.0');
    expect(fileVersion('club-commander_1.1.0_amd64.deb')).toBe('1.1.0');
  });
});

describe('buildDesktopCatalog', () => {
  it('the live v1.0.6 release: version, date, sizes, one file per kind, primary first', () => {
    const c = buildDesktopCatalog(V106);
    expect(c.version).toBe('1.0.6');
    expect(c.publishedAt).toBe('2026-02-10T04:08:06Z');
    expect(c.releaseUrl).toBe(V106.html_url);
    expect(c.platforms.windows.map((d) => [d.kind, d.fileName, d.label])).toEqual([
      ['win-setup', 'Club.Commander.Setup.1.0.5.exe', 'Windows Installer'],
      ['win-portable', 'Club.Commander.1.0.5.exe', 'Windows Portable'],
    ]);
    expect(c.platforms.mac.map((d) => [d.kind, d.arch, d.label])).toEqual([
      ['mac-dmg', 'arm64', 'macOS Disk Image'],
      ['mac-zip', 'arm64', 'macOS ZIP Archive'],
    ]);
    expect(c.platforms.linux.map((d) => d.fileName)).toEqual(['Club.Commander-1.0.5.AppImage', 'club-commander_1.0.5_amd64.deb']);
    expect(c.platforms.windows[0].sizeLabel).toBe('74.9 MB');
    expect(c.platforms.windows[0].url).toBe(`${DL}/v1.0.6/Club.Commander.Setup.1.0.5.exe`);
    expect(c.macArches).toEqual(['arm64']);
  });

  it('1.1.0: both Mac chips are offered and labelled, metadata is dropped', () => {
    const c = buildDesktopCatalog(V110);
    expect(c.version).toBe('1.1.0');
    expect(c.platforms.mac.map((d) => d.label)).toEqual([
      'macOS Disk Image (Apple Silicon)', 'macOS Disk Image (Intel)',
      'macOS ZIP Archive (Apple Silicon)', 'macOS ZIP Archive (Intel)',
    ]);
    expect(c.platforms.windows.map((d) => d.fileName)).toEqual(['Club-Commander-Setup-1.1.0.exe', 'Club-Commander-Portable-1.1.0.exe']);
    expect(c.platforms.linux.map((d) => d.kind)).toEqual(['linux-appimage', 'linux-deb']);
    const all = [...c.platforms.windows, ...c.platforms.mac, ...c.platforms.linux];
    expect(all.some((d) => /blockmap|\.yml$/.test(d.fileName))).toBe(false);
    expect(c.macArches.sort()).toEqual(['arm64', 'x64']);
  });

  it('refuses drafts, prereleases, foreign URLs and empty releases', () => {
    expect(buildDesktopCatalog({ ...V106, draft: true })).toBeNull();
    expect(buildDesktopCatalog({ ...V106, prerelease: true })).toBeNull();
    expect(buildDesktopCatalog({ ...V106, assets: [] })).toBeNull();
    expect(buildDesktopCatalog(null)).toBeNull();
    const evil = { ...V106, assets: [{ name: 'Club.Commander.Setup.1.0.5.exe', size: 1, state: 'uploaded', browser_download_url: 'https://evil.example/setup.exe' }] };
    expect(buildDesktopCatalog(evil)).toBeNull();
    const pending = { ...V106, assets: [{ ...V106.assets[5], state: 'new' }] };
    expect(buildDesktopCatalog(pending)).toBeNull();
    expect(buildDesktopCatalog({ ...V106, html_url: 'https://evil.example/' }).releaseUrl).toBe(RELEASES_PAGE_URL);
  });
});

describe('pickDownload: the old /api/download?platform= keys', () => {
  it('resolve against v1.0.6 and 1.1.0', () => {
    const old = buildDesktopCatalog(V106);
    const neu = buildDesktopCatalog(V110);
    expect(LEGACY_PLATFORM_KEYS.map((k) => pickDownload(old, k)?.fileName)).toEqual([
      'Club.Commander.Setup.1.0.5.exe', 'Club.Commander.1.0.5.exe', 'Club.Commander-1.0.5-arm64.dmg',
      'Club.Commander-1.0.5-arm64-mac.zip', 'Club.Commander-1.0.5.AppImage', 'club-commander_1.0.5_amd64.deb',
    ]);
    expect(LEGACY_PLATFORM_KEYS.map((k) => pickDownload(neu, k)?.fileName)).toEqual([
      'Club-Commander-Setup-1.1.0.exe', 'Club-Commander-Portable-1.1.0.exe', 'Club-Commander-1.1.0-arm64.dmg',
      'Club-Commander-1.1.0-arm64.zip', 'Club-Commander-1.1.0-x86_64.AppImage', 'club-commander_1.1.0_amd64.deb',
    ]);
    expect(pickDownload(old, 'nope')).toBeNull();
    expect(pickDownload(null, 'win-setup')).toBeNull();
  });
});

describe('small helpers', () => {
  it('formatBytes and platformFromUserAgent', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(98063200)).toBe('93.5 MB');
    expect(platformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(platformFromUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(platformFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
  });
});

describe('getLatestDesktopRelease: cache, failure and stale answers', () => {
  beforeEach(() => __resetDesktopReleaseCache());
  const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
  const fail = (status) => async () => ({ ok: false, status, json: async () => ({}) });

  it('reads once per 10 minutes', async () => {
    let calls = 0;
    const fetchImpl = async (...a) => { calls += 1; return ok(V106)(...a); };
    let t = 1_000_000;
    const now = () => t;
    expect((await getLatestDesktopRelease({ fetchImpl, now })).catalog.version).toBe('1.0.6');
    t += CACHE_TTL_MS - 1;
    await getLatestDesktopRelease({ fetchImpl, now });
    expect(calls).toBe(1);
    t += 2;
    await getLatestDesktopRelease({ fetchImpl, now });
    expect(calls).toBe(2);
  });

  it('a rate limit with nothing cached is unavailable, with the reason', async () => {
    const r = await getLatestDesktopRelease({ fetchImpl: fail(403), now: () => 1 });
    expect(r).toEqual({ catalog: null, stale: false, error: 'GitHub answered 403' });
  });

  it('a failure after a good read serves the last catalog as stale, for up to a day', async () => {
    let t = 1_000_000;
    await getLatestDesktopRelease({ fetchImpl: ok(V106), now: () => t });
    t += CACHE_TTL_MS + 1;
    const stale = await getLatestDesktopRelease({ fetchImpl: async () => { throw new Error('network down'); }, now: () => t });
    expect(stale.stale).toBe(true);
    expect(stale.catalog.version).toBe('1.0.6');
    t += STALE_LIMIT_MS;
    const gone = await getLatestDesktopRelease({ fetchImpl: fail(500), now: () => t });
    expect(gone.catalog).toBeNull();
  });
});
