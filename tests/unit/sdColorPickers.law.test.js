/**
 * A COLOUR SETTING CAN ONLY HOLD AN APPROVED #SMARTERDESIGN COLOUR (2026-11-28)
 *
 * PR #166 moved every colour written in source to the #SMARTERDESIGN tokens,
 * but four editors (clock presets, chip denominations, game types, the
 * waitlist desk theme) still offered the browser's free colour wheel, and the
 * boards painted whatever had been saved, so one click put yellow, gold,
 * purple or pink back on a TV board. The fix: src/lib/commander/sdPalette.js
 * (SD_SWATCHES + normalizeSdColor), SdSwatchPicker in every editor, and the
 * normaliser on every read and every API write of a saved colour.
 * Changelog: docs/changelog/2026-11-28-sd-colour-pickers.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  SD_SWATCHES, normalizeSdColor, normalizeSdColors, isBannedColor, isApprovedSwatch,
  normalizeClockPreset, DESK_COLOR_KEYS, CLOCK_THEME_KEYS,
} from '../../src/lib/commander/sdPalette.js';

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function files(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...files(p));
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const APPROVED = new Set(SD_SWATCHES.map((s) => s.hex));

// Real prohibited values seen in Commander history (scripts/smarterdesign-palette.mjs).
const BANNED = [
  '#FFD700', '#F59E0B', '#F5A623', '#FBBF24', '#EAB308', '#D4AF37', '#DAA520', '#B8860B', '#FEF3C7',
  '#FFA500', '#8B5CF6', '#A855F7', '#7C3AED', '#C084FC', '#9333EA', '#9146FF', '#E6E6FA', '#B57EDC',
  '#EC4899', '#F472B6', '#DB2777', '#D946EF', '#FF00FF', '#FFC0CB', '#1A0A2E', '#1A1508', '#ffd700',
  '#fc0', 'gold', 'purple', 'magenta', 'rgba(212, 175, 55, 0.3)', '#D4AF3780',
];

describe('sdPalette: the approved set and the normaliser', () => {
  it('every swatch is a valid, unique, Title Case colour and none is a banned hue', () => {
    expect(SD_SWATCHES.length).toBeGreaterThanOrEqual(12);
    expect(APPROVED.size).toBe(SD_SWATCHES.length);
    for (const s of SD_SWATCHES) {
      expect(s.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(s.label).toMatch(/^[A-Z][a-z]*( [A-Z][a-z]*)*$/);
      expect(isBannedColor(s.hex), s.hex).toBe(false);
    }
    // the semantic pair and the core tokens are offered
    for (const hex of ['#FFFFFF', '#BDD0E2', '#86DAFF', '#22D3EE', '#1981EC', '#0C55C0', '#040D18', '#31A24C', '#EF4444']) {
      expect(APPROVED.has(hex), hex).toBe(true);
    }
  });

  it('maps every banned hue to an approved swatch (keeping alpha and form)', () => {
    for (const c of BANNED) {
      expect(isBannedColor(c), c).toBe(true);
      const out = normalizeSdColor(c);
      const hex = out.startsWith('rgb') ? null : out.slice(0, 7).toUpperCase();
      if (hex) expect(APPROVED.has(hex), `${c} -> ${out}`).toBe(true);
      expect(isBannedColor(out), `${c} -> ${out}`).toBe(false);
    }
    expect(normalizeSdColor('#D4AF3780')).toMatch(/^#[0-9A-F]{6}80$/);
    expect(normalizeSdColor('rgba(212, 175, 55, 0.3)')).toMatch(/^rgba\(\d+, \d+, \d+, 0\.3\)$/);
    // pale gold stays pale, dark purple stays dark
    expect(normalizeSdColor('#FFD700')).toBe('#86DAFF');
    expect(['#0A1829', '#040D18', '#0D192E']).toContain(normalizeSdColor('#1A0A2E'));
  });

  it('passes approved and non-banned colours through unchanged', () => {
    for (const s of SD_SWATCHES) expect(normalizeSdColor(s.hex)).toBe(s.hex);
    for (const c of ['#ffffff', '#1981ec', '#EF4444', '#F87171', '#6366F1', '#3B82F6', '#E0F2FE', '#666666', '#333', 'rgba(0,0,0,0.3)', 'linear-gradient(#000, #fff)']) {
      expect(normalizeSdColor(c), c).toBe(c);
    }
    expect(normalizeSdColor(undefined, '#1981EC')).toBe('#1981EC');
    expect(normalizeSdColor('', '#1981EC')).toBe('#1981EC');
    expect(normalizeSdColor(null)).toBe(null);
  });

  it('normalises whole saved objects without touching other fields', () => {
    const desk = normalizeSdColors({ headerColor: '#D4AF37', accentColor: '#FFD700', bgColor: '#000000', logoUrl: 'x', playerFontSize: 28 }, DESK_COLOR_KEYS);
    expect(isApprovedSwatch(desk.headerColor)).toBe(true);
    expect(isApprovedSwatch(desk.accentColor)).toBe(true);
    expect(desk.bgColor).toBe('#000000');
    expect(desk.logoUrl).toBe('x');
    expect(desk.playerFontSize).toBe(28);
    const preset = normalizeClockPreset({ id: 1, theme: { background: '#1a0a2e', accent: '#F59E0B', headerBg: 'rgba(0,0,0,0.3)' }, display_options: { chip_denominations: [{ value: 5, color: '#8B5CF6' }, { value: 25, color: '#31A24C' }] } });
    expect(isBannedColor(preset.theme.background)).toBe(false);
    expect(isBannedColor(preset.theme.accent)).toBe(false);
    expect(preset.theme.headerBg).toBe('rgba(0,0,0,0.3)');
    expect(isApprovedSwatch(preset.display_options.chip_denominations[0].color)).toBe(true);
    expect(preset.display_options.chip_denominations[1].color).toBe('#31A24C');
    expect(CLOCK_THEME_KEYS).toContain('accent');
  });
});

describe('no free colour wheel anywhere', () => {
  it('no <input type="color"> in pages/, src/ or vendored commander-shared', () => {
    const hits = [];
    for (const dir of ['pages', 'src', 'vendor/commander-shared/src']) {
      for (const f of files(dir)) {
        const src = read(f);
        if (/type\s*=\s*\{?\s*["'`]color["'`]/.test(src) || /type:\s*["'`]color["'`]/.test(src)) hits.push(f);
      }
    }
    expect(hits).toEqual([]);
  });

  it('each colour editor renders SdSwatchPicker', () => {
    for (const f of ['pages/commander/clock-setup.js', 'pages/commander/game-types.js', 'pages/commander/waitlist/desk.js']) {
      const src = read(f);
      expect(src, f).toMatch(/import SdSwatchPicker from '[./]+\/src\/components\/commander\/shared\/SdSwatchPicker'/);
      expect(src, f).toMatch(/<SdSwatchPicker\b/);
    }
    // clock setup: four theme colours plus each chip
    expect(read('pages/commander/clock-setup.js').match(/<SdSwatchPicker\b/g).length).toBe(2);
  });

  it('SdSwatchPicker offers SD_SWATCHES as real, named, 44px buttons', () => {
    const src = read('src/components/commander/shared/SdSwatchPicker.jsx');
    expect(src).toMatch(/swatches = SD_SWATCHES/);
    expect(src).toMatch(/<button[\s\S]*?type="button"/);
    expect(src).toMatch(/aria-label=\{`\$\{label\}: \$\{s\.label\}`\}/);
    expect(src).toMatch(/aria-pressed=\{on\}/);
    expect(src).toMatch(/width: 44, height: 44/);
    expect(src).toMatch(/normalizeSdColor\(value\)/);
  });
});

describe('every read and write of a saved colour goes through the normaliser', () => {
  it('pages read desk_customization only through normalizeSdColors', () => {
    const readers = files('pages').filter((f) => !f.startsWith('pages/api') && /desk_customization/.test(read(f)));
    expect(readers.sort()).toEqual(['pages/commander/displays/waitlist.js', 'pages/commander/waitlist/desk.js']);
    for (const f of readers) {
      const src = read(f);
      expect(src, f).toMatch(/normalizeSdColors\(json\.data\.desk_customization, DESK_COLOR_KEYS\)/);
      expect(src, f).not.toMatch(/\.\.\.json\.data\.desk_customization\b/);
    }
  });

  it('pages that load clock presets to paint them normalise them', () => {
    const src = read('pages/commander/clock-setup.js');
    expect(src).toMatch(/setPresets\(\(json\.data \|\| \[\]\)\.map\(normalizeClockPreset\)\)/);
    expect(read('pages/commander/tournaments/[id]/clock-display.js')).toMatch(/setPreset\(normalizeClockPreset\(found\)\)/);
    // any other page that paints preset.theme must do the same
    for (const f of files('pages')) {
      if (f.startsWith('pages/api')) continue;
      const s = read(f);
      if (/clock-presets/.test(s) && /\.theme\b/.test(s)) expect(s, f).toMatch(/normalizeClockPreset/);
    }
  });

  it('game types and membership plans read their colour through normalizeSdColor', () => {
    expect(read('pages/commander/game-types.js')).toMatch(/setGameTypes\(\(json\.data \|\| \[\]\)\.map\(gt => \(\{ \.\.\.gt, color: normalizeSdColor\(gt\.color/);
    const cashier = read('pages/commander/cashier.js');
    expect(cashier).toMatch(/color: normalizeSdColor\(plan\.color, '#1981EC'\)/);
    expect(cashier).not.toMatch(/plan\.color \|\|/);
  });

  it('every API that stores a colour normalises it on write', () => {
    expect(read('pages/api/game-types.js')).toMatch(/color: normalizeSdColor\(color, '#1981EC'\)/);
    expect(read('pages/api/game-types.js')).toMatch(/key === 'color' \? normalizeSdColor\(req\.body\[key\]/);
    expect(read('pages/api/membership-plans.js')).toMatch(/color: normalizeSdColor\(color, '#1981EC'\)/);
    expect(read('pages/api/membership-plans.js')).toMatch(/updates\.color = normalizeSdColor\(updates\.color/);
    expect(read('pages/api/settings.js')).toMatch(/normalizeSdColors\(filtered\.desk_customization, DESK_COLOR_KEYS\)/);
    const cp = read('pages/api/clock-presets.js');
    expect(cp).toMatch(/theme: normalizeSdColors\(theme \|\| \{\}, CLOCK_THEME_KEYS\)/);
    expect(cp).toMatch(/updates\.theme = normalizeSdColors\(theme, CLOCK_THEME_KEYS\)/);
    expect(cp.match(/normalizeClockDisplayOptions\(display_options/g).length).toBe(2);
  });
});

describe('every default and starter colour is a swatch (so the picker shows it chosen)', () => {
  const hexes = (block) => [...block.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase());
  const between = (src, start, end) => { const i = src.indexOf(start); return src.slice(i, src.indexOf(end, i)); };

  it('waitlist desk and TV board share approved defaults', () => {
    const a = between(read('pages/commander/waitlist/desk.js'), 'const DEFAULT_CUSTOM', '};');
    const b = between(read('pages/commander/displays/waitlist.js'), 'const DEFAULT_CUSTOM', '};');
    expect(hexes(a)).toEqual(hexes(b));
    expect(hexes(a).length).toBe(DESK_COLOR_KEYS.length);
    for (const h of hexes(a)) expect(APPROVED.has(h), h).toBe(true);
  });

  it('clock defaults, starter themes and chips use swatches only', () => {
    const src = read('pages/commander/clock-setup.js');
    const blocks = [between(src, 'const DEFAULT_THEME', '};'), between(src, 'chip_denominations: [', '],'), between(src, 'const STARTER_THEMES', '];')];
    for (const block of blocks) for (const h of hexes(block)) expect(APPROVED.has(h), h).toBe(true);
    expect(src).not.toMatch(/Royal Purple|Gold Elite/);
  });

  it('game type presets use swatches only', () => {
    const block = between(read('pages/commander/game-types.js'), 'const PRESET_GAMES', '];');
    for (const h of hexes(block)) expect(APPROVED.has(h), h).toBe(true);
  });
});
