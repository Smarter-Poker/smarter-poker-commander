#!/usr/bin/env node
/**
 * VENDOR DRIFT GUARD
 * ═══════════════════════════════════════════════════════════════════════════
 * Closes the vendoring-drift bug CLASS that produced three separate
 * production incidents in a single week (Aug 2026):
 *
 *   1. CJS-under-ESM zero-exports.
 *      vendor/commander-shared is `"type": "module"`. A file inside it that
 *      uses `module.exports` / `require()` is parsed as ESM, so those tokens
 *      reference undefined CommonJS globals and the module exports NOTHING.
 *      Every `import { parseBlindStructure }` from it silently resolved to
 *      `undefined` at runtime. Bit us in parseBlindStructure.js AND
 *      home-games/rpcBridge.js.
 *
 *   2. Override bypass.
 *      Several src/ files are REAL local overrides that fix a bug in the
 *      vendored twin (apiRateLimit's spoofable IP parsing, supabase client,
 *      authUtils, home-games/rpcBridge). When a caller imports the vendor
 *      path directly (`@smarter-poker/commander-shared/lib/apiRateLimit`)
 *      instead of the local override, it silently runs the UNFIXED code.
 *      This is exactly how the mock-supabase-client and the forgeable-vendor
 *      -auth bugs reached production.
 *
 * Neither failure throws. Neither fails the build. Both ship green and break
 * in prod. This script is the missing static gate for both.
 *
 * USAGE
 *   node scripts/check-vendor-drift.mjs
 *
 *   Exit 0 = clean.
 *   Exit 1 = drift found, printed file:line by file:line.
 *
 * Dependency-free on purpose: runs as a Build Safety Gate CI step, which
 * does not `npm install`. Pure Node 18+ fs + string scanning.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const VENDOR_PKG = 'vendor/commander-shared';
const VENDOR_SRC = join(VENDOR_PKG, 'src');
const VENDOR_NAME = '@smarter-poker/commander-shared';

// ── helpers ────────────────────────────────────────────────────────────────

// Walk a directory returning every *.js path (relative to ROOT).
function walkJs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.next') continue;
      out.push(...walkJs(p));
    } else if (ent.isFile() && ent.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

// Replace every comment and string/template BODY with spaces, preserving
// newlines (so line numbers survive), length, AND the string delimiter quotes
// themselves. Preserving the quotes is deliberate: it lets the import regex
// still see `from '…'` structure on the stripped code (the specifier interior
// is blanked, and we recover the real text from the raw source). It also means
// tokens like `module.exports` / `require(` inside comments or string bodies
// never produce false positives.
function blankCommentsAndStrings(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const NORMAL = 0, LINE = 1, BLOCK = 2, SQ = 3, DQ = 4, TPL = 5;
  let state = NORMAL;
  const blank = (idx) => { if (out[idx] !== '\n') out[idx] = ' '; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (state === NORMAL) {
      if (c === '/' && d === '/') { state = LINE; blank(i); blank(i + 1); i += 2; continue; }
      if (c === '/' && d === '*') { state = BLOCK; blank(i); blank(i + 1); i += 2; continue; }
      if (c === "'") { state = SQ; i++; continue; }   // keep the delimiter
      if (c === '"') { state = DQ; i++; continue; }   // keep the delimiter
      if (c === '`') { state = TPL; i++; continue; }  // keep the delimiter
      i++; continue;
    }
    if (state === LINE) {
      if (c === '\n') { state = NORMAL; i++; continue; }
      blank(i); i++; continue;
    }
    if (state === BLOCK) {
      if (c === '*' && d === '/') { blank(i); blank(i + 1); state = NORMAL; i += 2; continue; }
      blank(i); i++; continue;
    }
    // string / template states — honour backslash escapes, keep closing quote
    if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
    if (state === SQ && c === "'") { state = NORMAL; i++; continue; }
    if (state === DQ && c === '"') { state = NORMAL; i++; continue; }
    if (state === TPL && c === '`') { state = NORMAL; i++; continue; }
    blank(i); i++; continue;
  }
  return out.join('');
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

// Extract every module specifier this file imports / re-exports from.
// Returns array of { spec, index }.
function importSpecifiers(codeStripped, rawSrc) {
  const specs = [];
  // import ... from 'x'  |  export ... from 'x'  |  import 'x'  |  import('x')
  const re = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(codeStripped)) !== null) {
    const spec = m[1] || m[2] || m[3];
    // the stripped source blanked the quote CONTENTS, so pull the real
    // specifier text from the raw source at the same offset.
    const rawSlice = rawSrc.slice(m.index, re.lastIndex);
    const q = rawSlice.match(/['"]([^'"]+)['"]/);
    specs.push({ spec: q ? q[1] : spec, index: m.index });
  }
  return specs;
}

// A "pure shim" re-exports the vendored twin and does nothing else: every
// statement is `export * from '…'` / `export { … } from '…'`. Such a file is
// interchangeable with importing the vendor path directly, so it carries no
// override to bypass. A REAL override has its own logic (even if it also
// imports a constant or two from the vendor).
function isPureShim(rawSrc) {
  const code = blankCommentsAndStrings(rawSrc).trim();
  if (!code) return false;
  // Remove all re-export-from statements; a shim has nothing left.
  const withoutReexports = code
    .replace(/\bexport\s+\*\s+(?:as\s+\w+\s+)?from\s*['"][^'"]*['"]\s*;?/g, '')
    .replace(/\bexport\s*\{[^}]*\}\s*from\s*['"][^'"]*['"]\s*;?/g, '')
    .trim();
  return withoutReexports.length === 0;
}

// ── CHECK A: CJS syntax inside the ESM vendor package ────────────────────────

function checkCjsUnderEsm() {
  const violations = [];
  // Confirm the package really is ESM; if not, this check is moot.
  const pkgPath = join(VENDOR_PKG, 'package.json');
  let isEsm = false;
  if (existsSync(pkgPath)) {
    try { isEsm = JSON.parse(readFileSync(pkgPath, 'utf8')).type === 'module'; } catch {}
  }
  if (!isEsm) {
    console.log(`[vendor-drift] ${VENDOR_PKG} is not "type":"module" — CJS check skipped.`);
    return violations;
  }

  for (const file of walkJs(VENDOR_SRC)) {
    const raw = readFileSync(file, 'utf8');
    const code = blankCommentsAndStrings(raw);
    const patterns = [
      { re: /\bmodule\.exports\b/g, what: 'module.exports' },
      { re: /\bexports\.\w+\s*=/g, what: 'exports.<name> =' },
      { re: /(^|[^.\w])require\s*\(/g, what: 'require(' },
    ];
    for (const { re, what } of patterns) {
      let m;
      while ((m = re.exec(code)) !== null) {
        // for the require pattern the match may start one char early
        const idx = m.index + (what === 'require(' && m[0][0] !== 'r' ? 1 : 0);
        violations.push({ file: relative(ROOT, file), line: lineOf(raw, idx), what });
      }
    }
  }
  return violations;
}

// ── CHECK B: callers bypassing a real local override ─────────────────────────

function checkOverrideBypass() {
  const violations = [];

  // 1. Discover real overrides: src/ files that shadow a vendor twin and are
  //    not pure shims. Map vendor-relative module id -> override file path.
  const overrides = new Map(); // moduleId (e.g. "lib/apiRateLimit") -> src path
  for (const vfile of walkJs(VENDOR_SRC)) {
    const moduleId = relative(VENDOR_SRC, vfile).split(sep).join('/').replace(/\.js$/, '');
    const srcTwin = join('src', relative(VENDOR_SRC, vfile));
    if (!existsSync(srcTwin)) continue;
    if (isPureShim(readFileSync(srcTwin, 'utf8'))) continue;
    overrides.set(moduleId, srcTwin.split(sep).join('/'));
  }

  if (overrides.size === 0) return violations;

  // 2. Scan every source file. Flag a direct vendor import of a module that
  //    has a real override — UNLESS the importer IS that override file.
  const scanDirs = ['pages', 'src', 'components', 'lib'].map((d) => join(ROOT, d));
  const allFiles = scanDirs.flatMap((d) => walkJs(d));
  for (const file of allFiles) {
    const relPath = relative(ROOT, file).split(sep).join('/');
    const raw = readFileSync(file, 'utf8');
    const code = blankCommentsAndStrings(raw);
    for (const { spec, index } of importSpecifiers(code, raw)) {
      if (!spec.startsWith(VENDOR_NAME + '/')) continue;
      const moduleId = spec.slice(VENDOR_NAME.length + 1);
      const overridePath = overrides.get(moduleId);
      if (!overridePath) continue;
      if (relPath === overridePath) continue; // the override may pull from vendor
      violations.push({
        file: relPath,
        line: lineOf(raw, index),
        spec,
        overridePath,
      });
    }
  }
  return violations;
}

// ── run ──────────────────────────────────────────────────────────────────────

let failed = false;

const cjs = checkCjsUnderEsm();
if (cjs.length) {
  failed = true;
  console.error('');
  console.error('[vendor-drift] CJS-under-ESM: CommonJS syntax inside the ESM vendor package.');
  console.error('  These files export NOTHING at runtime — every named import of them is undefined.');
  console.error('  Convert to ESM (import / export).');
  for (const v of cjs) console.error(`    ${v.file}:${v.line}  ${v.what}`);
} else {
  console.log('[vendor-drift] CHECK A ok — no CJS syntax in the ESM vendor package.');
}

const bypass = checkOverrideBypass();
if (bypass.length) {
  failed = true;
  console.error('');
  console.error('[vendor-drift] Override bypass: importing the vendor path directly runs the UNFIXED code.');
  console.error('  Import the local override instead (the src/ twin), which carries the fix.');
  for (const v of bypass) {
    console.error(`    ${v.file}:${v.line}  imports "${v.spec}"`);
    console.error(`        -> use the local override: ${v.overridePath}`);
  }
} else {
  console.log('[vendor-drift] CHECK B ok — no caller bypasses a local override.');
}

if (failed) {
  console.error('');
  console.error('[vendor-drift] FAILED. See above. This class of drift ships green and breaks in prod.');
  process.exit(1);
}
console.log('[vendor-drift] PASSED.');
process.exit(0);
