/**
 * THE SERVER AND THE FIRST CLIENT RENDER PRODUCE THE SAME HTML (2026-11-28)
 *
 * Production threw React #425 ("Text content does not match server-rendered
 * HTML") then #423 (whole root re-rendered on the client) on 52 of 108
 * Commander routes (Playwright console capture against `next start`). Two
 * causes, both fixed at the source:
 *
 *  1. `<style>{`css`}</style>`: React escapes text children on the server
 *     (`'` -> `&#x27;`, `>` -> `&gt;`), the browser keeps them literally inside
 *     <style>, so the client's text never matched. Pages now use
 *     `src/components/commander/shared/InlineStyle.jsx` (inner HTML, same bytes
 *     both sides).
 *  2. Wall clocks from `useState(new Date())`: read on the server and again in
 *     the browser seconds later. Pages now use `src/hooks/useClientNow.js`
 *     (null until mounted) and format through formatClientTime/Date/DateTime.
 *
 * Changelog: docs/changelog/2026-11-28-hydration-safe-render.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import InlineStyle, { safeCss } from '../../src/components/commander/shared/InlineStyle.jsx';
import useClientNow, {
  CLIENT_TIME_PLACEHOLDER, formatClientTime, formatClientDate, formatClientDateTime,
} from '../../src/hooks/useClientNow.js';

const ROOT = join(__dirname, '..', '..');
const raw = (p) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments blanked, so prose that names a trap is not the trap. */
const read = (p) => raw(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
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
const APP = [...files('pages'), ...files('src')].filter((f) => !f.startsWith('pages/api/'));

// Vendored commander-shared files that still write <style>{`...`}</style>. They
// are fixed upstream-first (CLAUDE.md law 3.5), then synced; this list may only
// shrink. CommanderLayout's is the one every staff page renders.
const VENDOR_STYLE_TEXT_DEBT = [
  'vendor/commander-shared/src/components/commander/admin/ArenaLedger.jsx',
  'vendor/commander-shared/src/components/commander/shared/CommanderEffectsProvider.jsx',
  'vendor/commander-shared/src/components/commander/shared/CommanderLayout.jsx',
  'vendor/commander-shared/src/components/commander/shared/DealerTicker.jsx',
  'vendor/commander-shared/src/components/commander/shared/FloorCallAlert.js',
  'vendor/commander-shared/src/components/ui/SkeletonDark.jsx',
];

// `useState(new Date())` kept only where the page renders nothing until the
// staff session (browser-only state) has loaded, so the value is never
// server-rendered.
const STAFF_GATED_DATE_STATE = ['pages/commander/tournament-maintenance.js'];

describe('InlineStyle', () => {
  it('server-renders CSS byte for byte (no entity escaping)', () => {
    const css = "a { font-family: 'Inter', \"Segoe UI\"; } b > c { content: '&'; }";
    expect(renderToString(React.createElement(InlineStyle, { css }))).toBe(`<style>${css}</style>`);
    // the trap it replaces
    expect(renderToString(React.createElement('style', null, css))).toMatch(/&#x27;Inter&#x27;/);
  });
  it('cannot be closed early by its CSS', () => {
    expect(safeCss('a{}</style><script>x</script>')).not.toMatch(/<\/style/i);
    expect(safeCss(undefined)).toBe('');
  });
});

describe('useClientNow', () => {
  it('renders the stable placeholder on the server (and so on the first client render)', () => {
    function Clock() {
      const [now] = useClientNow({ intervalMs: 1000 });
      return React.createElement('p', null, formatClientTime(now, { hour: 'numeric', minute: '2-digit' }));
    }
    expect(renderToString(React.createElement(Clock))).toBe(`<p>${CLIENT_TIME_PLACEHOLDER}</p>`);
  });
  it('formats a real time once mounted', () => {
    const d = new Date(2026, 10, 28, 13, 5, 0);
    expect(formatClientTime(d, { hour: 'numeric', minute: '2-digit' })).toBe('1:05 PM');
    expect(formatClientDate(d, { month: 'long', day: 'numeric' })).toBe('November 28');
    expect(formatClientDateTime(d.getTime())).toMatch(/11\/28\/2026/);
    for (const f of [formatClientTime, formatClientDate, formatClientDateTime]) expect(f(null)).toBe(CLIENT_TIME_PLACEHOLDER);
  });
});

describe('no render path reads text the server cannot reproduce', () => {
  it('no <style>{...}</style> text child in pages/ or src/', () => {
    const hits = APP.filter((f) => /<style>\s*\{/.test(read(f)) && !f.endsWith('InlineStyle.jsx'));
    expect(hits).toEqual([]);
  });

  it('vendored <style> text children only shrink (upstream-first fix pending)', () => {
    const now = files('vendor/commander-shared/src').filter((f) => /<style>\s*\{/.test(read(f))).sort();
    for (const f of now) expect(VENDOR_STYLE_TEXT_DEBT, f).toContain(f);
  });

  it('no clock read into initial state', () => {
    const hits = [];
    for (const f of APP) {
      if (STAFF_GATED_DATE_STATE.includes(f)) continue;
      const src = read(f);
      if (/useState\(\s*(?:\(\)\s*=>\s*)?(?:new Date\(\)|Date\.now\(\))\s*\)/.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it('no new Date().toLocale...() or now.toLocale...() rendered directly in JSX', () => {
    const hits = [];
    for (const f of APP) {
      const src = read(f);
      // `${new Date()...}` inside template strings (print windows) is not JSX.
      if (/(?<!\$)\{\s*new Date\(\)\.toLocale/.test(src)) hits.push(`${f}: new Date()`);
      if (/\bnow\.toLocale(?:Time|Date)?String\(/.test(src)) hits.push(`${f}: now.toLocale`);
    }
    expect(hits).toEqual([]);
  });

  it('pages that show a live clock use useClientNow', () => {
    const clockPages = [
      'pages/commander/floor.js', 'pages/commander/lobby.js', 'pages/commander/displays/tables.js',
      'pages/commander/displays/combined.js', 'pages/commander/displays/dealers.js',
      'pages/commander/displays/announcements.js', 'pages/commander/displays/promotions.js',
      'pages/commander/displays/leaderboard.js', 'pages/commander/player/[tableNumber].js',
      'pages/commander/tournaments/[id]/seating-display.js', 'pages/commander/tournaments/[id]/structure-display.js',
      'pages/commander/close-day.js', 'pages/commander/shift-handoff.js',
    ];
    for (const f of clockPages) {
      const src = read(f);
      expect(src, f).toMatch(/import useClientNow\b[^;]*from '[./]+\/src\/hooks\/useClientNow'/);
      expect(src, f).toMatch(/formatClient(?:Time|Date|DateTime)\(now/);
    }
  });
});
