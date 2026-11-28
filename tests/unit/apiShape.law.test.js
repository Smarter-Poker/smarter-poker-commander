/**
 * NO STAFF PAGE WHITE-SCREENS ON A BAD API ANSWER (2026-11-28)
 *
 * scripts/check-api-resilience.mjs (run by the required CI build job against
 * the build it just made) found nine staff pages that crashed to
 * "Application error" and four Tournament Director screens that lost their
 * header when an API answered with an empty array, an empty object,
 * data: null, an error body or a 500. The root was the same everywhere:
 * `json.data.x || []` read straight off the response. On an array,
 * `[].entries` is Array.prototype.entries, a function, which `|| []` keeps.
 * These laws pin the reader, the pages and the CI step.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { apiData, asArray, asObject, asNumber, apiFailed, apiError } from '../../src/lib/commander/apiShape.js';

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...filesUnder(p));
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('apiShape reads any answer without trusting it', () => {
  it('apiData is always a plain object', () => {
    for (const json of [null, undefined, {}, [], 'x', { data: null }, { data: [] }, { data: 'x' }, { success: false, error: 'x' }]) {
      expect(apiData(json)).toEqual({});
    }
    expect(apiData({ success: true, data: { a: 1 } })).toEqual({ a: 1 });
  });

  it('an array answer never leaks Array.prototype methods as fields', () => {
    const d = apiData({ success: true, data: [] });
    expect(d.entries).toBeUndefined();
    expect(d.filter).toBeUndefined();
    expect(asArray(d.entries)).toEqual([]);
  });

  it('asArray, asObject and asNumber give defaults of their kind', () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray({ length: 2 })).toEqual([]);
    expect(asArray([1])).toEqual([1]);
    expect(asObject([])).toEqual({});
    expect(asObject(null)).toEqual({});
    expect(asNumber('3')).toBe(3);
    expect(asNumber('x', 7)).toBe(7);
  });

  it('apiFailed and apiError name a failed answer', () => {
    expect(apiFailed({ ok: false, status: 500 }, { error: 'x' })).toBe(true);
    expect(apiFailed({ ok: true }, { success: false, error: 'x' })).toBe(true);
    expect(apiFailed({ ok: true }, null)).toBe(true);
    expect(apiFailed({ ok: true }, {})).toBe(false);
    expect(apiFailed({ ok: true }, { success: true, data: [] })).toBe(false);
    expect(apiError({ ok: false, status: 500 }, { error: 'Down' }, 'Members')).toBe('Could Not Load Members (500): Down');
    expect(apiError(null, { error: { message: 'x' } }, 'Members')).toBe('Could Not Load Members');
  });
});

describe('staff pages read API answers through apiShape', () => {
  it('no page reads json.data.<field> straight off a response', () => {
    const offenders = [];
    for (const f of [...filesUnder('pages/commander'), ...filesUnder('src/components/commander')]) {
      const src = read(f);
      for (const m of src.matchAll(/\b(data|json|result|body|res|\w+Json|\w+Data|\w+Res|json2)\.data\.([A-Za-z_]\w*)/g)) {
        offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders, 'read the payload with apiData(json).field / asArray(json.data)').toEqual([]);
  });

  it('the pages that white-screened normalise their answer and show a retry', () => {
    const pages = [
      'pages/commander/time-clock.js',
      'pages/commander/table-vibes.js',
      'pages/commander/system-info.js',
      'pages/commander/shift-handoff.js',
      'pages/commander/churn-prediction.js',
      'pages/commander/members.js',
      'pages/commander/reports/tax-compliance.js',
      'pages/commander/td/[tournamentId]/index.js',
      'pages/commander/td/[tournamentId]/reports.js',
      'pages/commander/td/[tournamentId]/chips.js',
      'pages/commander/td/[tournamentId]/color-up.js',
      'pages/commander/td/[tournamentId]/dealers.js',
    ];
    for (const f of pages) {
      const src = read(f);
      expect(src, f).toMatch(/from '[./]+src\/lib\/commander\/apiShape'/);
      expect(src, f).toMatch(/<LoadError\b[^>]*onRetry=/);
    }
  });

  it('Tournament Director loading and error screens keep the layout', () => {
    for (const f of ['index', 'chips', 'color-up', 'dealers']) {
      const src = read(`pages/commander/td/[tournamentId]/${f}.js`);
      const errorBlock = src.match(/if \((?:error \|\| !\w+)\) \{\n {4}return \(\n {6}(<\w+)/);
      expect(errorBlock && errorBlock[1], f).toBe('<CommanderLayout');
      const loadingBlock = src.match(/if \(loading\) \{\n {4}return \(\n {6}(<\w+)/);
      expect(loadingBlock && loadingBlock[1], f).toBe('<CommanderLayout');
    }
  });
});

describe('CI opens every page against bad answers', () => {
  it('the required build job runs the resilience check on the build it made', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/- name: Every staff page survives a bad API answer[\s\S]*?node scripts\/check-api-resilience\.mjs/);
    expect(ci).not.toMatch(/Every staff page survives a bad API answer[\s\S]{0,200}continue-on-error/);
    const script = read('scripts/check-api-resilience.mjs');
    for (const mode of ['empty-array', 'empty-object', 'null-data', 'error-body', 'http-500', 'http-401']) {
      expect(script).toContain(`'${mode}'`);
    }
    expect(script).toMatch(/pageerror/);
    expect(script).toMatch(/\[data-page-image-header\]/);
  });
});
