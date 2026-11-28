/**
 * #SMARTERDESIGN POLISH LAW FOR CLUB COMMANDER (2026-11-28)
 *
 * Three finishing rules from the #SmarterDesign programme backlog:
 *  1. Title Case on every UI label, including the manager PIN gate (it said
 *     "ACCESS RESTRICTED" and spoke in sentence case). Upstream
 *     commander-shared carries the same pin (tests/pin-gate-title-case.test.mjs).
 *  2. Page content sits in the image header's frame: the header wrap is at
 *     most 1600px with the --cmd-sd-gutter side padding, and every page root
 *     after it takes exactly those outer edges, with page-level columns
 *     filling it, from the shared skin (never page by page).
 *  3. Dense staff pages (Comps, Floor Calls, Incidents) have no text under
 *     12px: badges and captions may be 12px, body text is 13px or larger.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const notTitleCase = (text) => text
  .replace(/\$\{[^}]*\}/g, ' ')
  .split(/[\s/]+/)
  .filter((w) => /^[a-z]/.test(w.replace(/^[("'`]+/, '')));

describe('PIN gate copy is Title Case', () => {
  const layout = read('vendor/commander-shared/src/components/commander/shared/CommanderLayout.jsx');

  it('title', () => {
    const m = layout.match(/<h2 className="cmd-pin-gate-title">([^<]+)<\/h2>/);
    expect(m && m[1]).toBe('Access Restricted');
  });

  it('subtitle', () => {
    const m = layout.match(/<p className="cmd-pin-gate-subtitle">([\s\S]*?)<\/p>/);
    expect(m).toBeTruthy();
    expect(notTitleCase(m[1].replace(/<br\s*\/>/g, ' '))).toEqual([]);
  });

  it('every fixed PIN error message', () => {
    const messages = [...layout.matchAll(/setPinError\((?:[^'`)]*\|\|\s*)?(['`])((?:(?!\1).)+)\1\)/g)].map((x) => x[2]);
    expect(messages.length).toBeGreaterThanOrEqual(6);
    for (const msg of messages) expect(notTitleCase(msg), msg).toEqual([]);
  });
});

describe('page content shares the image header frame', () => {
  const skin = read('styles/commander-smarterdesign.css');
  const GUTTER = 'clamp(8px, 2vw, 24px)';

  it('the header wrap is the 1600px frame with the shared gutter', () => {
    const wrap = skin.match(/\.cmd-sd-header-wrap \{([^}]*)\}/);
    expect(wrap).toBeTruthy();
    expect(wrap[1]).toMatch(/max-width: 1600px;/);
    expect(wrap[1]).toContain(`padding: clamp(8px, 1.6vw, 16px) ${GUTTER} `);
    expect(skin).toContain(`--cmd-sd-gutter: ${GUTTER};`);
  });

  it('every page root after the header takes the header edges', () => {
    const rule = skin.match(/\.cmd-sd \[data-page-image-header\] ~ :not\(\.fixed\)[^{]*\{([^}]*)\}/);
    expect(rule, 'page root frame rule missing').toBeTruthy();
    expect(rule[1]).toContain('margin-inline: max(var(--cmd-sd-gutter), calc((100% - 1600px) / 2 + var(--cmd-sd-gutter))) !important;');
    expect(rule[1]).toContain('max-width: none !important;');
  });

  it('page-level columns fill the frame; dialogs and fixed overlays are excluded', () => {
    for (const cls of ['max-w-7xl', 'max-w-6xl', 'max-w-5xl', 'max-w-4xl', 'max-w-3xl', 'max-w-2xl', 'max-w-xl', 'max-w-lg']) {
      expect(skin, cls).toContain(`.${cls}`);
    }
    for (const px of [900, 960, 1100, 1200, 1400]) {
      expect(skin).toContain(`[style*="max-width:${px}px"], [style*="max-width: ${px}px"]`);
    }
    expect(skin).toContain(':not([role="dialog"] *)');
    expect(skin).toContain(':not(.fixed *)');
    // Cards and empty states (max-w-sm / max-w-md) keep their width.
    const frame = skin.slice(skin.indexOf('Page content frame'));
    expect(frame).not.toMatch(/\.max-w-(sm|md)\b/);
  });

  it('the image header is still rendered inside that frame wrapper', () => {
    expect(read('src/components/commander/shared/CommanderImageHeader.jsx')).toMatch(/className="cmd-sd-header-wrap" data-page-image-header=""/);
  });
});

describe('dense pages have readable text', () => {
  const PAGES = ['pages/commander/comps.js', 'pages/commander/floor-calls.js', 'pages/commander/incidents.js'];
  const TOO_SMALL = [
    /text-\[(?:[0-9]|1[01])px\]/g,
    /fontSize:\s*'?(?:[0-9]|1[01])(?:px)?'?\s*[,}]/g,
    /text-\[0\.(?:[0-6]\d*)rem\]/g,
  ];

  for (const page of PAGES) {
    it(`${page} has nothing under 12px`, () => {
      const src = read(page);
      const hits = TOO_SMALL.flatMap((re) => src.match(re) || []);
      expect(hits, `text under 12px in ${page}`).toEqual([]);
    });
  }

  it('body copy on those pages is 13px', () => {
    const comps = read('pages/commander/comps.js');
    expect(comps).toMatch(/<p className="text-\[13px\] text-\[#93A9C0\]">\{cat\.desc\}<\/p>/);
    expect(comps).toMatch(/text-\[13px\] text-\[#BDD0E2\]">Players Earn Comps Per Hour Of Play/);
    expect(read('pages/commander/floor-calls.js')).toMatch(/fontSize: 13, color: '#9FB3C8', margin: '0 0 6px', lineHeight: 1\.4 \}\}>\{call\.description\}/);
    expect(read('pages/commander/incidents.js')).toMatch(/fontSize: 14, color: '#F2F7FF', lineHeight: 1\.5, whiteSpace: 'pre-wrap' \}\}>\{incident\.description\}/);
  });
});
