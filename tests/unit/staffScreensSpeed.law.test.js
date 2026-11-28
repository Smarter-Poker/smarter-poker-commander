/**
 * STAFF SCREENS SPEED LAW (2026-11-28)
 *
 * docs/changelog/2026-11-28-staff-screens-speed.md. Pins what made the busiest
 * staff screens fast, so it cannot quietly come back:
 *  1. client code takes role/route access from the pure roleAccess module,
 *     never from lib/commander/auth.js (which imports node crypto and the
 *     server Supabase helpers: 125 kB of First Load JS on every
 *     CommanderLayout page);
 *  2. the global header art and the login background are served as WebP with
 *     the original kept as the fallback source, and the default portrait is a
 *     small file;
 *  3. header scenes over 760px wide have a 640px copy that the header offers
 *     through srcSet, and the list matches the files;
 *  4. the budget script measures what `next build` prints and recognises the
 *     crypto polyfill; CI runs it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER_SCENE_640 } from '../../src/components/commander/shared/headerSceneVariants';
import { firstLoadKB, hasCryptoPolyfill } from '../../scripts/check-first-load-budget.mjs';

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const VENDOR = 'vendor/commander-shared/src';

describe('staff screens speed', () => {
  it('roleAccess is pure and auth.js re-exports it', () => {
    const pure = read(`${VENDOR}/lib/commander/roleAccess.js`);
    expect(pure).not.toMatch(/^\s*import\b/m);
    expect(pure).not.toMatch(/require\(/);
    for (const name of ['COMP_ROLES', 'DEFAULT_PERMISSIONS', 'SENSITIVE_ROUTES', 'isSensitiveRoute', 'ROLE_ROUTE_ACCESS', 'canRoleAccessRoute', 'getEffectivePermissions']) {
      expect(pure).toMatch(new RegExp(`export (const|function) ${name}\\b`));
    }
    expect(read(`${VENDOR}/lib/commander/auth.js`)).toMatch(/\} from '\.\/roleAccess';/);
    expect(read('src/lib/commander/auth.js')).toMatch(/\} from '@smarter-poker\/commander-shared\/lib\/commander\/roleAccess';/);
  });

  it('no client component or page imports lib/commander/auth', () => {
    const offenders = [];
    const scan = (dir) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) { if (rel !== 'pages/api') scan(rel); continue; }
        if (!/\.(js|jsx|ts|tsx)$/.test(name)) continue;
        if (/from ['"][^'"]*lib\/commander\/auth['"]/.test(read(rel))) offenders.push(rel);
      }
    };
    for (const dir of ['pages', 'src/components', `${VENDOR}/components`, `${VENDOR}/hooks`]) scan(dir);
    expect(offenders).toEqual([]);
    expect(read(`${VENDOR}/components/commander/shared/CommanderLayout.jsx`)).toContain("from '../../../lib/commander/roleAccess'");
    expect(read('pages/commander/dashboard.js')).toContain("from '../../src/lib/commander/roleAccess'");
  });

  it('the global header art is WebP with the PNG as fallback, in both owners', () => {
    for (const [file, cls] of [[`${VENDOR}/components/commander/shared/CommanderLayout.jsx`, 'cmd'], ['src/components/commander/shared/StandaloneGlobalHeader.jsx', 'standalone']]) {
      const src = read(file);
      expect(src).toMatch(new RegExp(`<picture className="${cls}-approved-header__picture">\\s*<source type="image/webp" srcSet="/images/global-header/global-header-824\\.webp 824w, /images/global-header/global-header-desktop\\.webp 1648w" sizes="100vw" />\\s*<img src="/images/global-header/global-header-desktop\\.png"`));
      expect(src).toContain(`.${cls}-approved-header__picture { display: contents; }`);
    }
    for (const f of ['global-header-desktop.webp', 'global-header-824.webp', 'global-header-desktop.png']) {
      expect(existsSync(join(ROOT, 'public/images/global-header', f)), f).toBe(true);
    }
    expect(statSync(join(ROOT, 'public/images/global-header/global-header-desktop.webp')).size).toBeLessThan(60 * 1024);
  });

  it('the login background is WebP with the JPEG fallback; the default portrait is small', () => {
    const login = read('pages/commander/login.js');
    expect(login).toMatch(/<picture>\s*<source type="image\/webp" srcSet="\/images\/commander\/login-bg-v2\.webp" \/>\s*<img\s+src="\/images\/commander\/login-bg-v2\.jpg"/);
    expect(statSync(join(ROOT, 'public/images/commander/login-bg-v2.webp')).size).toBeLessThan(80 * 1024);
    expect(statSync(join(ROOT, 'public/default-avatar.png')).size).toBeLessThan(40 * 1024);
  });

  it('every wide header scene has a 640px copy, and the list matches the files', () => {
    const dir = join(ROOT, 'public/images/smarterdesign/headers');
    const copies = readdirSync(dir).filter((f) => f.endsWith('-scene-640.webp')).map((f) => f.replace('-scene-640.webp', '')).sort();
    expect(Object.keys(HEADER_SCENE_640).sort()).toEqual(copies);
    for (const [art, width] of Object.entries(HEADER_SCENE_640)) {
      expect(existsSync(join(dir, `${art}-scene.webp`)), art).toBe(true);
      expect(width).toBeGreaterThan(760);
      // VP8X/VP8 canvas width check is overkill; the copy must be smaller.
      expect(statSync(join(dir, `${art}-scene-640.webp`)).size).toBeLessThan(statSync(join(dir, `${art}-scene.webp`)).size);
    }
    const header = read('src/components/commander/shared/CommanderImageHeader.jsx');
    expect(header).toContain('srcSet={sceneSrcSet}');
    expect(header).toContain('${asset}-scene-640.webp 640w, ${asset}-scene.webp ${sceneWidth}w');
  });

  it('the budget script measures First Load JS like next build and spots the crypto polyfill', () => {
    const manifest = { pages: { '/_app': ['a.js', 'b.js', 'x.css'], '/r': ['a.js', 'c.js'] } };
    const sizes = { 'a.js': 10, 'b.js': 20, 'c.js': 5, 'x.css': 99 };
    expect(firstLoadKB(manifest, '/r', (f) => sizes[f])).toBe(35);
    expect(hasCryptoPolyfill('a.prototype._createNamed=function(t){e=r(6144).runInThisContext("(function "')).toBe(true);
    expect(hasCryptoPolyfill('export const x = 1')).toBe(false);
    const budget = JSON.parse(read('scripts/ci/first-load-budget.json')).budgets;
    expect(Object.keys(budget).sort()).toEqual(['/commander/cashier', '/commander/dashboard', '/commander/login', '/commander/tables', '/commander/waitlist/desk']);
    for (const kb of Object.values(budget)) expect(kb).toBeLessThan(215);
    expect(read('.github/workflows/ci.yml')).toContain('run: node scripts/check-first-load-budget.mjs');
  });
});
