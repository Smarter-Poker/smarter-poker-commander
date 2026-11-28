/**
 * RETIRED STAFF SCREENS ARE SERVER REDIRECTS, NOT PAGES (2026-11-28)
 *
 * Four screens were consolidated into newer ones on 2026-08-20 and kept alive
 * as client-side redirect pages so floor-tablet bookmarks never 404 mid-event.
 * Each still shipped a page bundle, a registry entry and an app-root header
 * slot for a screen nobody sees. The bookmarks are now honoured by
 * next.config.js redirects() and the page files are deleted.
 *
 * Pins: each retired URL redirects (temporary) to the screen that replaced it,
 * the dynamic id is carried into the target, the old page files stay deleted,
 * and nothing in the app still registers or links to the retired routes.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import nextConfig from '../../next.config.js';
import { PAGE_HEADERS } from '../../src/components/commander/shared/pageHeaders.js';

const ROOT = join(__dirname, '..', '..');

const RETIRED = [
  { source: '/commander/tournament-clocks', destination: '/commander/displays', file: 'pages/commander/tournament-clocks.js' },
  { source: '/commander/tournament-registration', destination: '/commander/tournament-controls', file: 'pages/commander/tournament-registration.js' },
  { source: '/commander/tournaments/:id/break-manager', destination: '/commander/td/:id/tables', file: 'pages/commander/tournaments/[id]/break-manager.js' },
  { source: '/commander/tournaments/:id', destination: '/commander/td/:id', file: 'pages/commander/tournaments/[id].js' },
];

// Pages that must keep working under /commander/tournaments/[id]/*. A broader
// source pattern (":id*", ":path*") would swallow them.
const LIVE_TOURNAMENT_SCREENS = ['clock-display', 'public', 'seating-display', 'settings', 'structure-display'];

const redirects = await nextConfig.redirects();

describe('retired staff screens', () => {
  for (const { source, destination, file } of RETIRED) {
    it(`${source} redirects to ${destination}`, () => {
      const rule = redirects.find((r) => r.source === source);
      expect(rule, `next.config.js redirects() has no rule for ${source}`).toBeTruthy();
      expect(rule.destination).toBe(destination);
      expect(rule.permanent).toBe(false);
      // No query in the destination: Next passes the request's query through.
      expect(rule.destination).not.toContain('?');
    });

    it(`${file} stays deleted`, () => {
      expect(existsSync(join(ROOT, file)), `${file} came back; the redirect lives in next.config.js`).toBe(false);
    });

    it(`${source} has no image header entry`, () => {
      expect(PAGE_HEADERS[source.replace(/:id/g, '[id]')]).toBeUndefined();
    });
  }

  it('the single-segment tournament rule never swallows a live tournament screen', () => {
    for (const r of redirects.filter((x) => x.source.startsWith('/commander/tournaments/'))) {
      expect(r.source).not.toMatch(/:\w+[*+]/);
    }
    for (const screen of LIVE_TOURNAMENT_SCREENS) {
      expect(existsSync(join(ROOT, `pages/commander/tournaments/[id]/${screen}.js`)), screen).toBe(true);
      expect(redirects.some((r) => r.source === `/commander/tournaments/:id/${screen}`)).toBe(false);
    }
  });

  it('the app root no longer reserves a header slot for them', () => {
    const app = readFileSync(join(ROOT, 'pages/_app.js'), 'utf8');
    for (const { source } of RETIRED) {
      expect(app).not.toContain(`'${source.replace(/:id/g, '[id]')}'`);
    }
  });
});
