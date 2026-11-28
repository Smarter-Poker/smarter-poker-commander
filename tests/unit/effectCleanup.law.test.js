/**
 * AN EFFECT RETURNS NOTHING OR A CLEANUP FUNCTION (2026-11-27)
 *
 * `useEffect(() => { if (!router.isReady) return null; ... })` and
 * `return router.push(...)` hand React a non-function as the effect's
 * cleanup. React calls it on unmount and throws "destroy is not a function",
 * which blanked /commander/members/[id] with "Application error" (found while
 * applying #SMARTERDESIGN; it reproduced on main). Five pages had it.
 * This scans every effect body's own top-level `return`s.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

function files(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...files(p));
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Comments blanked (same length, newlines kept) so line numbers survive. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (c, pre) => pre + ' '.repeat(c.length - pre.length));
}

function badEffectReturns(raw) {
  const src = stripComments(raw);
  const bad = [];
  const re = /useEffect\(\s*(?:async\s*)?\(\)\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let top = '';
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (c === '{') { depth++; top += ' '; continue; }
      if (c === '}') { depth--; top += ' '; continue; }
      top += depth === 1 ? c : (c === '\n' ? '\n' : ' ');
    }
    for (const r of top.matchAll(/\breturn\s+([^;\n]*)/g)) {
      const e = r[1].trim();
      if (!e) continue;
      if (/^(\(\s*\)|\(?[\w$]+\)?\s*=>|function\b|undefined\b)/.test(e)) continue;
      if (/^[A-Za-z_$][\w$]*$/.test(e) && !['null', 'false', 'true'].includes(e)) continue;
      bad.push(`${src.slice(0, m.index).split('\n').length}: return ${e.slice(0, 60)}`);
    }
  }
  return bad;
}

describe('effects return nothing or a cleanup function', () => {
  it('no effect returns null, a boolean or a promise', () => {
    const offenders = [];
    for (const f of [...files('pages'), ...files('src'), ...files('vendor/commander-shared/src')]) {
      for (const b of badEffectReturns(readFileSync(join(ROOT, f), 'utf8'))) offenders.push(`${f}:${b}`);
    }
    expect(offenders).toEqual([]);
  });
});
