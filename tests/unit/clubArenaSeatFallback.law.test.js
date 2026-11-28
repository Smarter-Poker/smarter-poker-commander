/**
 * OLD-BROWSER SEAT FALLBACK LAW (2026-11-28)
 *
 * The table seat badges are sized in container units (#178). Safari < 16 and
 * Chrome < 105 have neither container units nor @container: they drop every
 * declaration that names `cqw`, so on an older venue tablet the badges lost
 * their sizes and overlapped. This pins the fallback:
 *  1. modern path unchanged: every seatScale() share resolves to exactly
 *     N cqw when --ca-u is unset (`var(--ca-u, 1cqw)`), and the @container
 *     compact layout is still there;
 *  2. no seat size names cqw outside a var() fallback (an old browser would
 *     drop it at parse time);
 *  3. the compact rules have a data-ca-compact twin with no cqw at all;
 *  4. feature detection is true only where container units are missing, and
 *     the fallback writes 1% of the measured box and the compact switch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  seatScale,
  compactFallbackCss,
  cssLacksContainerUnits,
  applySeatBoxFallback,
  SEAT_UNIT_VAR,
  SEAT_COMPACT_MAX_PX,
  SEAT_BOX_CLASS,
} from '../../src/components/commander/shared/ClubArenaTable';

const SKIN = readFileSync(join(__dirname, '..', '..', 'src/components/commander/shared/ClubArenaTable.jsx'), 'utf8');

/** Evaluate a seatScale() value the way a browser would, for a box width. */
function resolve(value, boxPx, unitPx) {
  const u = unitPx ?? boxPx / 100; // modern: 1cqw is 1% of the box
  const m = value.match(/^clamp\((\d+)px, calc\(([\d.]+) \* var\(--ca-u, 1cqw\)\), (\d+)px\)$/);
  expect(m, value).toBeTruthy();
  const [, lo, n, hi] = m;
  return Math.min(Number(hi), Math.max(Number(lo), Number(n) * u));
}

describe('old-browser seat fallback', () => {
  it('seatScale keeps the modern container-unit size and survives without cqw', () => {
    const sp = seatScale(1050);
    expect(sp(52)).toBe('clamp(23px, calc(4.952 * var(--ca-u, 1cqw)), 52px)');
    expect(sp(13, 8)).toBe('clamp(8px, calc(1.238 * var(--ca-u, 1cqw)), 13px)');
    // The only cqw is the var() fallback, which an old browser never parses.
    expect(sp(52).replace('var(--ca-u, 1cqw)', '')).not.toMatch(/cqw/);
    // Same numbers both ways: modern cqw and the measured fallback unit.
    for (const box of [330, 520, 760, 1050, 1400]) {
      expect(resolve(sp(52), box)).toBeCloseTo(resolve(sp(52), box, box / 100), 6);
    }
    expect(resolve(sp(52), 1050)).toBeCloseTo(52, 1); // full size at the 1280 reference
    expect(resolve(sp(52), 330)).toBe(23); // floor on a phone
  });

  it('the compact layout exists twice: @container, and a cqw-free data-ca-compact twin', () => {
    expect(SKIN).toMatch(/@container \(max-width: \$\{SEAT_COMPACT_MAX_PX\}px\)\{\$\{SEAT_COMPACT_RULES\}\}/);
    expect(SKIN).toContain('${compactFallbackCss()}');
    const css = compactFallbackCss();
    expect(css).not.toMatch(/cqw/);
    const selectors = [...css.matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) => m[2].trim());
    expect(selectors.length).toBeGreaterThanOrEqual(10);
    for (const sel of selectors) {
      for (const part of sel.split(',')) expect(part.trim().startsWith(`.${SEAT_BOX_CLASS}[data-ca-compact] `)).toBe(true);
    }
    expect(css).toContain('.ca-seat-box[data-ca-compact] .ca-seat__meta{display:none!important}');
    expect(css).toContain('max-width:calc(16 * var(--ca-u))!important');
    expect(css).toContain('font-size:clamp(8px,calc(2.5 * var(--ca-u)),10px)!important');
  });

  it('feature detection: fallback only where container units are missing', () => {
    const supports = (yes) => ({ supports: (q) => yes.some((y) => q.includes(y)) });
    expect(cssLacksContainerUnits(supports(['cqw', 'container-type']))).toBe(false); // Safari 16+, Chrome 105+
    expect(cssLacksContainerUnits(supports([]))).toBe(true); // Safari 15, Chrome 104
    expect(cssLacksContainerUnits(supports(['container-type']))).toBe(true);
    expect(cssLacksContainerUnits(undefined)).toBe(true); // no CSS.supports at all
    expect(cssLacksContainerUnits({ supports: () => { throw new Error('x'); } })).toBe(true);
  });

  it('writes 1% of the measured box, the compact switch and, without aspect-ratio, the height', () => {
    const attrs = new Map();
    const props = new Map();
    const box = {
      style: { setProperty: (k, v) => props.set(k, v), height: '' },
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: (k) => attrs.delete(k),
    };
    const modernCss = { supports: () => true };
    applySeatBoxFallback(box, 1050, modernCss);
    expect(props.get(SEAT_UNIT_VAR)).toBe('10.500px');
    expect(attrs.has('data-ca-compact')).toBe(false);
    expect(box.style.height).toBe('');
    applySeatBoxFallback(box, SEAT_COMPACT_MAX_PX, modernCss);
    expect(attrs.has('data-ca-compact')).toBe(true);
    applySeatBoxFallback(box, 330, { supports: (q) => !q.includes('aspect-ratio') });
    expect(props.get(SEAT_UNIT_VAR)).toBe('3.300px');
    expect(box.style.height).toBe('330px');
    applySeatBoxFallback(box, 900, modernCss);
    expect(attrs.has('data-ca-compact')).toBe(false);
    applySeatBoxFallback(box, 0, modernCss); // unmeasured: leave the last good value
    expect(props.get(SEAT_UNIT_VAR)).toBe('9.000px');
  });

  it('the felt measures its own seat box with ResizeObserver, only when needed', () => {
    expect(SKIN).toMatch(/if \(!seatBoxNeedsFallback\(\)\) return undefined;/);
    expect(SKIN).toMatch(/closest\(`\.\$\{SEAT_BOX_CLASS\}`\)/);
    expect(SKIN).toMatch(/new window\.ResizeObserver\(measure\)/);
    expect(SKIN).toMatch(/<img\s+ref=\{ref\}/);
  });
});
