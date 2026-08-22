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

import { readFileSync, readdirSync, existsSync, statSync, lstatSync, realpathSync } from 'fs';
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

// ── CHECK C: the installed package must BE the vendor dir, not a copy of it ──
//
// `"@smarter-poker/commander-shared": "file:vendor/commander-shared"` normally
// makes npm SYMLINK node_modules/@smarter-poker/commander-shared at the vendor
// directory, so an edit to the vendor source is live immediately. Under some
// npm versions and flag combinations it materialises a real COPY instead, and
// from that moment the two diverge silently: you edit vendor/, the app keeps
// running the snapshot, and nothing anywhere says so. Every symptom points at
// the source file being wrong, which it is not.
//
// This is a LOCAL hazard. CI checks out clean and `npm install` repopulates
// node_modules from vendor on every run, so a stale copy cannot exist there —
// which is exactly why nothing caught it. The check therefore SKIPS when
// node_modules is absent (this step deliberately runs before install) and only
// speaks on a developer or agent machine, where the damage happens.
function checkInstalledLinkage() {
  const installed = join(ROOT, 'node_modules', VENDOR_NAME);
  if (!existsSync(join(ROOT, 'node_modules'))) {
    return { skipped: true, reason: 'node_modules absent (pre-install step)' };
  }
  if (!existsSync(installed)) {
    return { skipped: true, reason: 'vendor package not installed' };
  }

  let st;
  try {
    st = lstatSync(installed);
  } catch (err) {
    return { skipped: true, reason: `unreadable: ${err.message}` };
  }

  if (st.isSymbolicLink()) {
    // A symlink is right, but it has to point at THIS repo's vendor dir.
    try {
      const target = realpathSync(installed);
      const expected = realpathSync(join(ROOT, VENDOR_PKG));
      if (target !== expected) {
        return { copy: false, wrongTarget: true, target, expected };
      }
    } catch {
      /* a broken link is reported by the install itself; not this check's job */
    }
    return { ok: true };
  }

  // A real directory here means npm copied. Report how far it has already
  // drifted so the message is a fact rather than a warning about a maybe.
  const drifted = [];
  for (const file of walkJs(join(VENDOR_PKG, 'src'))) {
    const rel = relative(join(ROOT, VENDOR_PKG), join(ROOT, file)).split(sep).join('/');
    const twin = join(installed, rel);
    if (!existsSync(twin)) { drifted.push(`${rel} (missing from the copy)`); continue; }
    try {
      if (readFileSync(join(ROOT, file), 'utf8') !== readFileSync(twin, 'utf8')) {
        drifted.push(rel);
      }
    } catch { /* unreadable twin counts as drift, reported by the missing case */ }
  }
  return { copy: true, drifted };
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

const linkage = checkInstalledLinkage();
if (linkage.skipped) {
  console.log(`[vendor-drift] CHECK C skipped — ${linkage.reason}.`);
} else if (linkage.copy) {
  failed = true;
  console.error('');
  console.error('[vendor-drift] Installed package is a COPY of vendor/commander-shared, not a symlink.');
  console.error('  Edits to vendor/ will NOT be picked up. Nothing will error; the app just runs');
  console.error('  the snapshot npm took at install time.');
  if (linkage.drifted.length) {
    console.error(`  It has already drifted on ${linkage.drifted.length} file(s):`);
    for (const f of linkage.drifted.slice(0, 20)) console.error(`    ${f}`);
    if (linkage.drifted.length > 20) console.error(`    ... and ${linkage.drifted.length - 20} more`);
  } else {
    console.error('  It matches vendor/ right now, but nothing keeps it that way.');
  }
  console.error('');
  console.error('  Fix:  rm -rf node_modules/@smarter-poker && npm install --legacy-peer-deps');
} else if (linkage.wrongTarget) {
  failed = true;
  console.error('');
  console.error('[vendor-drift] Installed package points at the WRONG vendor directory.');
  console.error(`    links to: ${linkage.target}`);
  console.error(`    expected: ${linkage.expected}`);
  console.error('  Fix:  rm -rf node_modules/@smarter-poker && npm install --legacy-peer-deps');
} else {
  console.log('[vendor-drift] CHECK C ok — vendor package is symlinked, not copied.');
}

if (failed) {
  console.error('');
  console.error('[vendor-drift] FAILED. See above. This class of drift ships green and breaks in prod.');
  process.exit(1);
}
console.log('[vendor-drift] PASSED.');
process.exit(0);
