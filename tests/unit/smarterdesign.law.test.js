/**
 * #SMARTERDESIGN LAW FOR CLUB COMMANDER (Dan, 2026-11-27)
 *
 * "CLUB COMMANDER NEEDS THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE,
 * SUBPAGE, BUTTON AND EVERYTHING ELSE, EXACTLY LIKE WE'VE DONE FOR EVERY OTHER
 * WORLD HUB PAGE."
 *
 * Pins the four things that make it true and keep it true:
 *  1. colours: nothing left on the old Facebook palette and no prohibited hue
 *     (yellow, gold, amber, purple, violet, pink, magenta) anywhere in source;
 *  2. every staff page has an image header entry, and its artwork exists;
 *  3. the header is wired on both paths (CommanderLayout slot, standalone
 *     routes in _app) with the one painted "?" and no second "?";
 *  4. the skin and primitives are loaded.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PAGE_HEADERS } from '../../src/components/commander/shared/pageHeaders.js';

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function pagesUnder(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...pagesUnder(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
const route = (file) => '/' + relative('pages', file).replace(/\.js$/, '').replace(/\/index$/, '');

// Routes that are deliberately headerless: wall displays, kiosks, table
// tablets, public check-in / tournament screens, sign-in and onboarding.
const HEADERLESS = new Set([
  '/commander', '/commander/login', '/commander/register', '/commander/onboarding',
  '/commander/kiosk', '/commander/lobby', '/commander/check-in/[code]',
  '/commander/dealer/[tableNumber]', '/commander/player/[tableNumber]',
  '/commander/tablet/[tableNumber]', '/commander/table/[id]',
  '/commander/waitlist/status/[id]',
  '/commander/displays/announcements', '/commander/displays/combined',
  '/commander/displays/dealers', '/commander/displays/leaderboard',
  '/commander/displays/promotions', '/commander/displays/tables',
  '/commander/displays/waitlist',
  '/commander/tournaments/[id]/clock-display', '/commander/tournaments/[id]/public',
  '/commander/tournaments/[id]/seating-display', '/commander/tournaments/[id]/structure-display',
]);

describe('#SMARTERDESIGN colours', () => {
  it('the palette migration has nothing left to change', () => {
    const out = execFileSync(process.execPath, ['scripts/smarterdesign-palette.mjs', '--check', 'pages', 'src', 'vendor/commander-shared/src', 'styles'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toMatch(/would change 0 file/);
  });
});

describe('#SMARTERDESIGN image headers', () => {
  const staffRoutes = pagesUnder('pages/commander').map(route).filter((r) => !HEADERLESS.has(r));

  it('every staff page has an image header entry', () => {
    const missing = staffRoutes.filter((r) => !PAGE_HEADERS[r]);
    expect(missing, `pages with no #SMARTERDESIGN header entry:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('every entry names a real page and has both artwork files', () => {
    const all = new Set(pagesUnder('pages/commander').map(route));
    for (const [r, entry] of Object.entries(PAGE_HEADERS)) {
      expect(all.has(r), `${r} is not a page`).toBe(true);
      expect(entry.title, `${r} needs a title`).toBeTruthy();
      for (const part of ['seal', 'scene']) {
        expect(existsSync(join(ROOT, 'public/images/smarterdesign/headers', `${entry.art}-${part}.webp`)), `${entry.art}-${part}.webp`).toBe(true);
      }
    }
  });

  // 2026-11-28: the registry went from 28 pairs over 85 pages (57 reuses,
  // whole sections on one scene) to 82 distinct pairs, each chosen by
  // looking at the art. The cap only ever comes down.
  const MAX_ART_REUSE = 3;

  it(`art is reused at most ${MAX_ART_REUSE} times, and only by the same job or section`, () => {
    const byArt = new Map();
    for (const [r, entry] of Object.entries(PAGE_HEADERS)) {
      if (!byArt.has(entry.art)) byArt.set(entry.art, []);
      byArt.get(entry.art).push([r, entry]);
    }
    const reuse = Object.keys(PAGE_HEADERS).length - byArt.size;
    expect(reuse, `page header art reused ${reuse} times (cap ${MAX_ART_REUSE})`).toBeLessThanOrEqual(MAX_ART_REUSE);
    for (const [art, pages] of byArt) {
      if (pages.length < 2) continue;
      const sameTitle = new Set(pages.map(([, e]) => e.title)).size === 1;
      const sameSection = new Set(pages.map(([r]) => r.split('/')[2])).size === 1;
      expect(sameTitle || sameSection, `${art} is shared across sections: ${pages.map(([r]) => r).join(', ')}`).toBe(true);
    }
  });

  it('every header image in the library is used by a page', () => {
    const dir = join(ROOT, 'public/images/smarterdesign/headers');
    const used = new Set(Object.values(PAGE_HEADERS).map((e) => e.art));
    const dashboard = read('pages/commander/dashboard.js');
    const orphans = readdirSync(dir)
      .filter((f) => /-(seal|scene)\.webp$/.test(f))
      .filter((f) => !used.has(f.replace(/-(seal|scene)\.webp$/, '')) && !dashboard.includes(`headers/${f}`));
    expect(orphans, 'header art nobody shows').toEqual([]);
  });

  // 2026-11-28: the three guide pages wrapped CommanderLayout around the
  // 40px section icon inside the article, so the whole layout and its image
  // header rendered in a 300px column beside the heading, one letter per line.
  it('the documentation guides wrap the whole page in CommanderLayout, once', () => {
    for (const f of ['staff-guide', 'manager-guide', 'troubleshooting']) {
      const src = read(`pages/commander/docs/${f}.js`);
      expect(src.match(/<CommanderLayout\b/g), f).toHaveLength(1);
      expect(src, f).toMatch(/\n  return \(\n    <CommanderLayout /);
    }
  });

  it('the vault belongs to Cashier and to nobody else', () => {
    const vault = Object.entries(PAGE_HEADERS).filter(([, e]) => e.art === 'cashier').map(([r]) => r);
    expect(vault).toEqual(['/commander/cashier']);
  });

  it('CommanderLayout renders the slot and _app fills it, plus the standalone routes', () => {
    const layout = read('vendor/commander-shared/src/components/commander/shared/CommanderLayout.jsx');
    expect(layout).toMatch(/<PageHeaderSlot title=\{title\} \/>\s*\{children\}/);
    const app = read('pages/_app.js');
    expect(app).toMatch(/<PageHeaderSlotContext\.Provider value=\{renderPageHeader\}>/);
    expect(app).toMatch(/\{needsAppHeader && <CommanderImageHeader \/>\}/);
    expect(app).toMatch(/<PageHelpHost>/);
  });

  it('the header uses the one painted "?" and never a return link inside the frame', () => {
    const header = read('src/components/commander/shared/CommanderImageHeader.jsx');
    expect(header).toMatch(/<PageHelp embedded /);
    expect(header).not.toMatch(/Back To|<Link|href=/);
    const help = read('src/components/commander/shared/PageHelp.jsx');
    expect(help).toMatch(/if \(delegate\) return null;/);
    expect(read('src/components/commander/shared/sdHeaderHelp.js')).toMatch(/\/images\/smarterdesign\/header-help\.webp/);
    expect(existsSync(join(ROOT, 'public/images/smarterdesign/header-help.webp'))).toBe(true);
  });
});

describe('#SMARTERDESIGN skin', () => {
  it('loads the primitives and the Commander skin with the chrome rims', () => {
    const app = read('pages/_app.js');
    expect(app).toMatch(/import '\.\.\/styles\/smarterdesign\.css';/);
    expect(app).toMatch(/import '\.\.\/styles\/commander-smarterdesign\.css';/);
    const skin = read('styles/commander-smarterdesign.css');
    for (const asset of ['chrome-readout.webp', 'chrome-row.webp', 'chrome-active-v2.webp']) {
      expect(skin).toContain(asset);
      expect(existsSync(join(ROOT, 'public/images/smarterdesign', asset))).toBe(true);
    }
  });
});
