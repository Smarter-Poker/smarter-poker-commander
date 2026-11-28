#!/usr/bin/env node
/**
 * FIRST LOAD BUDGET FOR THE BUSIEST STAFF SCREENS (2026-11-28)
 *
 * Reads the production build (.next/build-manifest.json) and measures, per
 * route, the gzip size of every JavaScript file a cold first load fetches:
 * the _app files plus the route's own (the "First Load JS" column of
 * `next build`, computed the same way: unique .js files, gzip level 9, kB). A route
 * fails when it exceeds its budget in scripts/ci/first-load-budget.json by
 * more than 5%. The budgets are the numbers measured after
 * docs/changelog/2026-11-28-staff-screens-speed.md, which took 125 KB off
 * every CommanderLayout page by keeping node crypto (crypto-browserify) and
 * the server Supabase helpers out of the browser.
 *
 * It also fails if ANY client chunk carries the crypto-browserify polyfill
 * again (its asn1 `_createNamed` / `runInThisContext` fingerprint): that is
 * what a client import of lib/commander/auth.js, or any other server module
 * that imports `crypto`, costs every page that imports it.
 *
 * Usage: node scripts/check-first-load-budget.mjs  (after `npm run build`)
 *        node scripts/check-first-load-budget.mjs --print   (measure only)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NEXT = join(ROOT, '.next');
const BUDGET_FILE = join(ROOT, 'scripts/ci/first-load-budget.json');
const TOLERANCE = 1.05;

/** gzip level 9 size in kB (1000 bytes), the unit `next build` prints. */
export function gzipKB(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length / 1000;
}

export function firstLoadKB(manifest, route, sizeOf) {
  const files = new Set([...(manifest.pages['/_app'] || []), ...(manifest.pages[route] || [])]);
  let kb = 0;
  for (const f of files) if (f.endsWith('.js')) kb += sizeOf(f);
  return kb;
}

export function hasCryptoPolyfill(src) {
  return src.includes('_createNamed') && src.includes('runInThisContext');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function main() {
  const manifestPath = join(NEXT, 'build-manifest.json');
  if (!existsSync(manifestPath)) {
    console.error('[first-load-budget] no .next/build-manifest.json - run `npm run build` first');
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { budgets } = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
  const cache = new Map();
  const sizeOf = (f) => {
    if (!cache.has(f)) cache.set(f, gzipKB(join(NEXT, f)));
    return cache.get(f);
  };
  const failures = [];
  for (const [route, budget] of Object.entries(budgets)) {
    if (!manifest.pages[route]) { failures.push(`${route}: not in the build`); continue; }
    const kb = firstLoadKB(manifest, route, sizeOf);
    const limit = budget * TOLERANCE;
    const verdict = kb > limit ? 'OVER' : 'ok';
    console.log(`[first-load-budget] ${route.padEnd(28)} ${kb.toFixed(1).padStart(6)} kB  budget ${budget} kB (+5% = ${limit.toFixed(1)})  ${verdict}`);
    if (kb > limit) failures.push(`${route}: ${kb.toFixed(1)} kB > ${limit.toFixed(1)} kB`);
  }
  if (!process.argv.includes('--print')) {
    for (const file of walk(join(NEXT, 'static/chunks'))) {
      if (hasCryptoPolyfill(readFileSync(file, 'utf8'))) failures.push(`crypto-browserify polyfill in client chunk ${file.slice(NEXT.length + 1)}`);
    }
  }
  if (failures.length && !process.argv.includes('--print')) {
    for (const f of failures) console.error(`[first-load-budget] FAIL ${f}`);
    process.exit(1);
  }
  console.log('[first-load-budget] PASSED');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
