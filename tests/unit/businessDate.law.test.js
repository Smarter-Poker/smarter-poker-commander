/**
 * THE BUSINESS DATE IS THE VENUE'S DATE, NEVER THE UTC DATE (2026-11-28)
 *
 * Forty-two call sites wrote "today" as `new Date().toISOString().split('T')[0]`
 * (or `.slice(0, 10)`): the UTC calendar date, which is TOMORROW from 6 PM
 * Central. Day closes, shift handoffs and dealer rotations were stamped on the
 * next day; reports, high hands, promotions, responsible-gaming limits and the
 * schedule all shifted. Every one now goes through
 * src/lib/commander/businessDate.js (shared module, vendored from
 * commander-shared) with the venue's zone from poker_venues.
 *
 * This law fails if the idiom comes back anywhere in pages/, src/ or the
 * vendored commander-shared, outside ALLOWED (each entry needs a reason).
 * Changelog: docs/changelog/2026-11-28-venue-business-date.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const raw = (p) => readFileSync(join(ROOT, p), 'utf8');
const read = (p) => raw(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
function files(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...files(p));
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const SOURCES = [...files('pages'), ...files('src'), ...files('vendor/commander-shared/src')];

/** ISO string cut to its UTC date (or its UTC date-and-minute for datetime-local). */
const UTC_DATE_CUT = /toISOString\(\)\s*\.\s*(?:split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]|(?:slice|substring|substr)\(\s*0\s*,\s*(?:10|16)\s*\))/;

// file -> why a UTC date (or UTC minute) is genuinely correct there.
const ALLOWED = {};

describe('no UTC calendar date stands in for a business date', () => {
  it('the toISOString() date cut is gone from pages/, src/ and vendored commander-shared', () => {
    const hits = [];
    for (const f of SOURCES) {
      if (ALLOWED[f]) continue;
      read(f).split('\n').forEach((line, i) => {
        if (UTC_DATE_CUT.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('every allowlist entry still exists, still uses the idiom, and says why', () => {
    for (const [f, why] of Object.entries(ALLOWED)) {
      expect(typeof why === 'string' && why.length > 20, f).toBe(true);
      expect(UTC_DATE_CUT.test(read(f)), `${f} no longer needs its exemption`).toBe(true);
    }
  });

  it('bare `${date}T00:00:00` / T23:59:59 day bounds (read as UTC by Postgres) are gone from API routes', () => {
    const hits = [];
    for (const f of files('pages/api')) {
      read(f).split('\n').forEach((line, i) => {
        if (/T(?:00:00:00|23:59:59)/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the stamped business dates come from the venue zone', () => {
    const stamps = [
      ['pages/api/close-day.js', /close_date:\s*businessDateKey\(new Date\(\), timeZone\)/],
      ['pages/api/shift-handoff.js', /shift_date:\s*businessDateKey\(new Date\(\), handoffTimeZone\)/],
      ['pages/api/dealer/scan-in.js', /rotation_date:\s*businessDateKey\(new Date\(\), rotationTimeZone\)/],
    ];
    for (const [f, re] of stamps) {
      const src = read(f);
      expect(src, f).toMatch(re);
      expect(src, f).toMatch(/fetchVenueTimeZone\(getSupabase\(\), /);
    }
  });

  it('the shim re-exports the one shared module, and the vendored copy is pure', () => {
    expect(read('src/lib/commander/businessDate.js')).toMatch(
      /export \* from '@smarter-poker\/commander-shared\/lib\/commander\/businessDate'/);
    expect(read('vendor/commander-shared/src/lib/commander/businessDate.js')).not.toMatch(/^\s*import /m);
  });

  it('date-only defaults on pages are set after mount, not in a useState initialiser', () => {
    const hits = [];
    for (const f of [...files('pages'), ...files('src')].filter((p) => !p.startsWith('pages/api/'))) {
      if (/useState\(\s*(?:businessDateKey|todayKey|todayISO|yearEndISO)\(/.test(read(f))) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});
