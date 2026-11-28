#!/usr/bin/env node
/**
 * #SMARTERDESIGN palette migration for Club Commander (2026-11-27).
 *
 * Dan: "CLUB COMMANDER NEEDS THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE
 * PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE". Commander was built on the
 * Facebook dark palette (#18191A / #242526 / #3A3B3C, accent #1877F2) and used
 * amber and purple text that #SMARTERDESIGN prohibits (docs/SMARTERDESIGN.md in
 * World Hub: never yellow, gold, amber, purple, violet, lavender, pink or
 * magenta). This script moves every colour at its source to the
 * #SMARTERDESIGN tokens (styles/smarterdesign.css): ink #040D18, surface
 * #0A1829, line #445E77, text #F2F7FF, silver #BDD0E2, ice #86DAFF, cobalt.
 *
 * It is deterministic and idempotent, and runs unchanged on both
 * smarter-poker-commander and commander-shared, so vendored files that were
 * identical to upstream stay identical (the vendor-upstream ratchet).
 *
 * Usage: node scripts/smarterdesign-palette.mjs <dir> [<dir> ...]
 *        node scripts/smarterdesign-palette.mjs --check <dir> ...  (exit 1 if anything would change)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// key = old hex (upper). Value: per Tailwind prefix family, or `all`.
// `other` covers inline styles, JS constants, SVG fills and anything not
// written as a Tailwind arbitrary class.
const MAP = {
  '18191A': { all: '040D18' },
  '242526': { all: '0A1829' },
  '2D2E30': { all: '0F2236' },
  '3A3B3C': { bg: '132A42', border: '445E77', text: '7F97B0', other: '2A4560' },
  '4A4B4C': { bg: '1B3753', border: '5A7590', text: '8FA6BE', other: '3A5873' },
  '4E4F50': { bg: '1B3753', border: '5A7590', text: '8FA6BE', other: '3A5873' },
  'E4E6EB': { all: 'F2F7FF' },
  'B0B3B8': { all: 'BDD0E2' },
  '8A8D91': { all: '9FB3C8' },
  '64748B': { all: '9FB3C8' },
  '6A6B6D': { all: '93A9C0' },
  '94A3B8': { all: 'A9BDD1' },
  '4A5E78': { text: '8FA6BE', other: '445E77' },
  '1877F2': { bg: '0C55C0', text: '86DAFF', other: '1981EC' },
  '1664D9': { all: '0A4AA8' },
  '1565D8': { all: '0A4AA8' },
  // Prohibited hues -> cyan / sky / blue (emphasis stays distinguishable).
  'F59E0B': { all: '22D3EE' },
  'F5A623': { all: '22D3EE' },
  'FBBF24': { all: '22D3EE' },
  'FFD700': { all: '22D3EE' },
  'EAB308': { all: '22D3EE' },
  'FACC15': { all: '22D3EE' },
  'F7B500': { all: '22D3EE' },
  'D97706': { all: '0EA5C6' },
  'B45309': { all: '0E7490' },
  '8B5CF6': { all: '5AA9FF' },
  'A855F7': { all: '5AA9FF' },
  '7C3AED': { all: '3B82F6' },
  'C084FC': { all: '93C5FD' },
  'A78BFA': { all: '93C5FD' },
  'EC4899': { all: '38BDF8' },
  // Gold / goldenrod / pale yellow (the waitlist board and badges).
  'D4AF37': { all: '86DAFF' },
  'DAA520': { all: '5FB8E0' },
  'B8860B': { all: '3A8FC0' },
  'F0AD4E': { all: '22D3EE' },
  'FEF3C7': { all: 'E0F2FE' },
  'FED7AA': { all: 'E0F2FE' },
  '52451E': { all: '1E3A52' },
  '6B5C2C': { all: '2C4A66' },
  // Remaining purples and magentas (including brand tints).
  '9333EA': { all: '3B82F6' },
  '9146FF': { all: '5AA9FF' },
  '2E1065': { all: '0B1E3A' },
  '351E52': { all: '10264A' },
  '4B2C6B': { all: '17325A' },
  '6B2D8B': { all: '1E4A80' },
  '880E4F': { all: '0E3A5F' },
  'E4405F': { all: '38BDF8' },
  // Indigo reads as violet beside the cobalt; keep it in the blue family.
  '6366F1': { all: '3B82F6' },
  '4F46E5': { all: '2563EB' },
  'FF3366': { all: '38BDF8' },
  'DB2777': { all: '0EA5E9' },
  'F472B6': { all: '7DD3FC' },
  'D946EF': { all: '38BDF8' },
};

const FAMILY = {
  bg: 'bg', from: 'bg', to: 'bg', via: 'bg', fill: 'bg',
  border: 'border', ring: 'border', outline: 'border', divide: 'border', stroke: 'border',
  text: 'text', placeholder: 'text', decoration: 'text', caret: 'text', accent: 'text', shadow: 'other',
};

function pick(hex, family) {
  const m = MAP[hex.toUpperCase()];
  if (!m) return null;
  return m.all || m[family] || m.other || null;
}

// rgba() forms of the prohibited hues.
const RGBA = [
  [/rgba?\(\s*245\s*,\s*158\s*,\s*11\b/g, 'rgba(34, 211, 238'],
  [/rgba?\(\s*245\s*,\s*166\s*,\s*35\b/g, 'rgba(34, 211, 238'],
  [/rgba?\(\s*251\s*,\s*191\s*,\s*36\b/g, 'rgba(34, 211, 238'],
  [/rgba?\(\s*255\s*,\s*215\s*,\s*0\b/g, 'rgba(34, 211, 238'],
  [/rgba?\(\s*139\s*,\s*92\s*,\s*246\b/g, 'rgba(90, 169, 255'],
  [/rgba?\(\s*168\s*,\s*85\s*,\s*247\b/g, 'rgba(90, 169, 255'],
  [/rgba?\(\s*236\s*,\s*72\s*,\s*153\b/g, 'rgba(56, 189, 248'],
  [/rgba?\(\s*24\s*,\s*119\s*,\s*242\b/g, 'rgba(25, 129, 236'],
  [/rgba?\(\s*212\s*,\s*175\s*,\s*55\b/g, 'rgba(134, 218, 255'],
  [/rgba?\(\s*180\s*,\s*150\s*,\s*60\b/g, 'rgba(95, 184, 224'],
  [/rgba?\(\s*80\s*,\s*60\s*,\s*10\b/g, 'rgba(10, 40, 70'],
  [/rgba?\(\s*255\s*,\s*51\s*,\s*102\b/g, 'rgba(56, 189, 248'],
];

const NAMED = { yellow: 'cyan', amber: 'cyan', purple: 'sky', violet: 'sky', fuchsia: 'sky', pink: 'sky' };
const NAMED_RE = /\b((?:[a-z-]+:)*)(text|bg|border|from|to|via|ring|fill|stroke|decoration|placeholder|accent|outline|divide|shadow|caret)-(yellow|amber|purple|violet|fuchsia|pink)-(\d{2,3})\b/g;

export function migrate(src) {
  let out = src;
  // 1. Tailwind arbitrary classes: prefix-[#HEX] (with optional alpha and /opacity).
  out = out.replace(/\b([a-z]+)-\[#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?\]/g, (all, prefix, hex, alpha) => {
    const fam = FAMILY[prefix];
    if (!fam) return all;
    const to = pick(hex, fam);
    return to ? `${prefix}-[#${to}${alpha || ''}]` : all;
  });
  // 2. Every other literal hex (inline styles, constants, SVG).
  out = out.replace(/#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?(?![0-9a-fA-F])/g, (all, hex, alpha) => {
    const to = pick(hex, 'other');
    return to ? `#${to}${alpha || ''}` : all;
  });
  // 3. rgba() of prohibited hues and the old accent.
  for (const [re, to] of RGBA) out = out.replace(re, to);
  // 4. Named Tailwind prohibited hues.
  out = out.replace(NAMED_RE, (all, variants, prefix, hue, shade) => `${variants}${prefix}-${NAMED[hue]}-${shade}`);
  return out;
}

const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.css']);
const SKIP_DIR = new Set(['node_modules', '.next', '.git', 'tests', '__tests__', 'test']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.has(extname(name)) && !/\.test\.|\.spec\./.test(name)) yield p;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  const dirs = check ? args.slice(1) : args;
  let changed = 0;
  for (const d of dirs) {
    for (const f of walk(d)) {
      if (f.endsWith('smarterdesign-palette.mjs')) continue;
      const src = readFileSync(f, 'utf8');
      const out = migrate(src);
      if (out !== src) {
        changed++;
        if (check) console.log(`would change: ${f}`);
        else writeFileSync(f, out);
      }
    }
  }
  console.log(`${check ? 'would change' : 'changed'} ${changed} file(s)`);
  if (check && changed) process.exit(1);
}
