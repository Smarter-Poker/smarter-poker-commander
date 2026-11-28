/**
 * SIGNED-IN LIVE PROOF: EVERY WORLD HUB PLAYER PAGE UNDER /hub/commander
 * (2026-11-28)
 *
 * The staff census (staff-headers.spec.ts) opens every Club Commander staff
 * page. The player side lives in the World Hub repo (pages/hub/commander/**,
 * 37 pages on 2026-11-28) and had no signed-in browser at all. This spec is
 * that browser.
 *
 * ROUTE LIST: read from the World Hub source on every run, never copied here.
 * The workflow sparse-checks-out Smarter-Poker/Smarter-Poker-World-Hub
 * pages/hub/commander and passes its path as HUB_COMMANDER_PAGES_DIR; locally
 * the sibling clone ../smarter-poker-world-hub is used. A new player page is
 * therefore covered the first run after it ships.
 *
 * SIGN-IN: the probe account (probeSession.ts) by a password grant; the
 * session goes into localStorage['smarter-poker-auth'] on smarter.poker, the
 * same platform session every hub page reads.
 *
 * ON EACH PAGE, at 393px (phone) and 1280px (desktop):
 *   - exactly one approved global header (.approved-global-header);
 *   - exactly one page image header (header.cmd-header-full / .cmd-header-bar)
 *     and exactly one painted "?" (.sd-header-help) in it, except the two
 *     non-pages (home-games/join: an invite-redeem hop; tournament/[id]/clock:
 *     a full-screen clock), which must show neither;
 *   - no uncaught page error, no Next.js "Application error" screen, and the
 *     page did not bounce to sign-in;
 *   - a full-page screenshot in test-results/player-pages/ (artifact).
 *
 * READ-ONLY: page loads only. Any non-GET request to /api/commander/* that a
 * page fires on load is aborted and fails the page (a page that writes when
 * merely opened is a defect). home-games/join is opened WITHOUT a code, so
 * it never attempts a join.
 *
 * Dynamic routes get real ids from the same public / own-account reads the
 * list pages already make (venues, active tournaments, active leagues, the
 * probe's home games, squads and hand sessions). With no id the route is
 * skipped with an annotation; ids are never invented. At least
 * MIN_VISITED routes must be visited or the run fails.
 */
import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertProbeSecrets, HAVE_PROBE_SECRETS, passwordGrant, seedPlatformSession } from './probeSession';

const ROOT = join(__dirname, '..', '..');
const HUB = process.env.PLAYWRIGHT_HUB_ORIGIN || 'https://smarter.poker';
const SIGNED_OUT = process.env.PLAYER_PAGES_SIGNED_OUT === '1';
const PAGES_DIR = process.env.HUB_COMMANDER_PAGES_DIR
  || join(ROOT, '..', 'smarter-poker-world-hub', 'pages', 'hub', 'commander');
const SHOTS = join(ROOT, 'test-results', 'player-pages');
const ONLY = process.env.PLAYER_PAGES_ROUTES ? new RegExp(process.env.PLAYER_PAGES_ROUTES) : null;
// 21 static pages + the 5 venue pages (a venue always exists) on 2026-11-28.
const MIN_VISITED = 26;
const MIN_ROUTES = 30;
/** Pages that are not pages: no image header and no painted "?" by design. */
const NON_PAGES = new Set(['/hub/commander/home-games/join', '/hub/commander/tournament/[id]/clock']);
const VIEWPORTS = [
  { name: 'phone', width: 393, height: 852 },
  { name: 'desktop', width: 1280, height: 900 },
];

assertProbeSecrets('player-pages.spec.ts');

/** pages/hub/commander/**.js -> /hub/commander/... routes. */
function hubCommanderRoutes(dir = PAGES_DIR): string[] {
  if (!existsSync(dir)) throw new Error(`World Hub player pages not found at ${dir} (set HUB_COMMANDER_PAGES_DIR)`);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|jsx|ts|tsx)$/.test(name) && !name.startsWith('_')) {
        const rel = relative(dir, p).replace(/\\/g, '/').replace(/\.(js|jsx|ts|tsx)$/, '').replace(/(^|\/)index$/, '');
        out.push(`/hub/commander${rel ? `/${rel}` : ''}`);
      }
    }
  };
  walk(dir);
  return out.sort();
}

type Ids = Record<string, string | null>;

/** Which id a dynamic segment needs, by route family. */
function idKind(route: string, segment: string): string {
  if (segment === 'venueId' || /^\/hub\/commander\/venues?\/\[id\]/.test(route)) return 'venue';
  if (segment === 'handId') return 'hand';
  if (segment === 'code') return 'squadCode';
  if (route.startsWith('/hub/commander/home-games/')) return 'homeGame';
  if (route.startsWith('/hub/commander/leagues/')) return 'league';
  if (route.startsWith('/hub/commander/squads/')) return 'squad';
  if (route.startsWith('/hub/commander/tournament/')) return 'tournament';
  return `unknown:${segment}`;
}

function concretePath(route: string, ids: Ids): { path: string | null; missing: string[] } {
  const missing: string[] = [];
  const path = route.replace(/\[([^\]]+)\]/g, (_, seg) => {
    const kind = idKind(route, seg);
    const v = ids[kind];
    if (!v) missing.push(kind);
    return encodeURIComponent(v || '');
  });
  return { path: missing.length ? null : path, missing };
}

/** Real ids from the reads the list pages make, as the signed-in probe. */
async function resolveIds(page: Page): Promise<Ids> {
  return page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('smarter-poker-auth') || '{}');
    const headers: Record<string, string> = auth.access_token ? { Authorization: `Bearer ${auth.access_token}` } : {};
    const get = async (url: string) => {
      try { const r = await fetch(url, { headers }); return r.ok ? r.json() : null; } catch { return null; }
    };
    // First row of the first non-empty array of objects anywhere in the body.
    const firstRow = (body: unknown): Record<string, unknown> | null => {
      const seen: unknown[] = [body];
      while (seen.length) {
        const v = seen.shift();
        if (Array.isArray(v)) {
          const row = v.find((x) => x && typeof x === 'object' && !Array.isArray(x));
          if (row) return row as Record<string, unknown>;
        } else if (v && typeof v === 'object') seen.push(...Object.values(v as object));
      }
      return null;
    };
    const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
    const venue = firstRow(await get('/api/commander/venues?limit=30'));
    const tour = firstRow(await get('/api/commander/tournaments?status=active'))
      || firstRow(await get('/api/commander/tournaments'));
    const league = firstRow(await get('/api/commander/leagues/active'));
    const group = firstRow(await get('/api/commander/home-games/groups?my_groups=true'))
      || firstRow(await get('/api/commander/home-games/discover?type=groups&limit=20'));
    const squads = await get('/api/commander/squads/my');
    const squad = firstRow(squads?.data?.squads || []);
    const session = firstRow(await get('/api/commander/hands/sessions'));
    const gameId = str(session?.game_id ?? session?.id);
    const hand = gameId ? firstRow(await get(`/api/commander/hands/game/${encodeURIComponent(gameId)}?limit=1`)) : null;
    return {
      venue: str(venue?.id),
      tournament: str(tour?.id),
      league: str(league?.id),
      homeGame: str(group?.id),
      squad: str(squad?.id),
      squadCode: str(squad?.invite_code ?? squad?.code),
      hand: str(hand?.id),
    };
  });
}

const fileFor = (path: string, vp: string) => join(SHOTS, `${path.replace(/^\//, '').replace(/[^a-zA-Z0-9-]+/g, '_')}.${vp}.png`);

test.describe('signed-in World Hub player pages', () => {
  test.skip(!SIGNED_OUT && !HAVE_PROBE_SECRETS,
    'PROBE_EMAIL / PROBE_PASSWORD secrets are not set on this repository: the signed-in player page pass did not run');
  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough for a per-page census (two widths)');
  // One census; a retry would re-run every page and could turn red green.
  test.describe.configure({ timeout: 30 * 60_000, retries: 0 });

  test('every /hub/commander page shows one global header, one image header and one painted "?"', async ({ page }, info) => {
    mkdirSync(SHOTS, { recursive: true });
    const routes = hubCommanderRoutes();
    expect(routes.length, `only ${routes.length} player pages found in ${PAGES_DIR}`).toBeGreaterThanOrEqual(MIN_ROUTES);

    if (SIGNED_OUT) await page.goto(`${HUB}/api/health`);
    else await seedPlatformSession(page, HUB, await passwordGrant());
    const ids: Ids = SIGNED_OUT ? {} : await resolveIds(page);
    info.annotations.push({ type: 'ids', description: JSON.stringify(ids) });

    // Per-navigation evidence.
    let errors: string[] = [];
    let writes: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/\/api\/commander\//, (route) => {
      const req = route.request();
      if (req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS') {
        writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
        return route.abort();
      }
      return route.continue();
    });

    let visited = 0;
    for (const route of routes) {
      if (ONLY && !ONLY.test(route)) continue;
      const { path, missing } = concretePath(route, ids);
      if (!path) { info.annotations.push({ type: 'skipped', description: `${route}: no ${missing.join(', ')} id available to the probe` }); continue; }
      const nonPage = NON_PAGES.has(route);

      await test.step(path, async () => {
        for (const vp of VIEWPORTS) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          errors = []; writes = [];
          const where = `${path} @${vp.width}px`;
          await page.goto(`${HUB}${path}`, { waitUntil: 'domcontentloaded' });
          await expect.soft(page.locator('.approved-global-header'), `${where}: exactly one global header`).toHaveCount(1, { timeout: 20_000 });
          const header = page.locator('header.cmd-header-full, header.cmd-header-bar');
          const help = page.locator('.sd-header-help');
          if (nonPage) {
            // Give a late header the chance to appear before asserting none.
            await page.waitForTimeout(2_500);
            await expect.soft(header, `${where}: non-page shows no image header`).toHaveCount(0);
            await expect.soft(help, `${where}: non-page shows no painted "?"`).toHaveCount(0);
          } else {
            await expect.soft(header, `${where}: exactly one image header`).toHaveCount(1, { timeout: 20_000 });
            await expect.soft(help, `${where}: exactly one painted "?"`).toHaveCount(1, { timeout: 10_000 });
            await page.waitForTimeout(1_000);
          }
          await expect.soft(page.getByText(/Application error/i), `${where}: Next.js application error`).toHaveCount(0);
          if (!SIGNED_OUT) {
            expect.soft(new URL(page.url()).pathname, `${where}: stayed on the page (signed in, no bounce to sign-in)`).toMatch(/^\/hub\/commander(\/|$)/);
          }
          expect.soft(errors, `${where}: uncaught page errors`).toEqual([]);
          expect.soft(writes, `${where}: page wrote on load`).toEqual([]);
          await page.screenshot({ path: fileFor(path, vp.name), fullPage: true });
        }
        visited += 1;
      });
    }

    info.annotations.push({ type: 'visited', description: String(visited) });
    // One line naming every failed assertion, so the workflow can raise it
    // as a single annotation readable without log access (the soft
    // assertions collect in info.errors; GitHub caps error annotations).
    const failures = info.errors.map((e) => {
      const lines = String(e.message || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
      const received = lines.find((l) => /^Received/.test(l));
      return [lines[0], received].filter(Boolean).join(' ');
    }).filter(Boolean);
    if (failures.length) console.log(`[player-pages] FAILURES (${failures.length}): ${failures.join(' || ')}`);
    console.log(`[player-pages] visited ${visited} of ${routes.length} player routes at 393px and 1280px; ${info.annotations.filter((a) => a.type === 'skipped').map((a) => a.description).join('; ') || 'none skipped'}`);
    if (!ONLY) expect(visited, 'too few player pages were visited').toBeGreaterThanOrEqual(MIN_VISITED);
  });
});
