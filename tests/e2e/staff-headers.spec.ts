/**
 * SIGNED-IN LIVE PROOF: EVERY STAFF PAGE WEARS ITS #SMARTERDESIGN HEADER
 * (2026-11-28)
 *
 * The #SmarterDesign programme (PR #166) gave every Club Commander staff page
 * a page image header with exactly one painted "?" for its help. It was only
 * ever verified signed out, on a local build with a fake staff session: no
 * signed-in browser had opened the real pages in production. This spec is
 * that browser.
 *
 * It signs in as the probe account (PROBE_EMAIL / PROBE_PASSWORD, the same
 * Commander owner test account the login-bridge probe uses) by a password
 * grant, hands the session to the commander origin the way supabase-js
 * stores it, lets /commander/login mint the signed staff session silently,
 * then opens every route in src/components/commander/shared/pageHeaders.js
 * except:
 *   - PIN-gated routes: the SENSITIVE_ROUTES list in the shared auth module
 *     (read from source, so the list has one owner) and /commander/admin/*,
 *     which middleware sends to the admin PIN entry;
 *   - routes that next.config.js redirects();
 *   - dynamic routes whose id the probe venue cannot supply (no tournament or
 *     no member yet): skipped with an annotation, never faked.
 * On each it asserts one visible [data-page-image-header] and exactly one
 * [data-page-help], and saves a full-page screenshot to
 * test-results/staff-headers/ (uploaded by the workflow as an artifact).
 *
 * Without the secrets the whole spec skips and says so. Never navigate to
 * anything that changes data: every visit is a page load.
 *
 * Local check without credentials (fake owner session, no real data):
 *   STAFF_HEADERS_FAKE_SESSION=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3311 CI=1 \
 *     npx playwright test tests/e2e/staff-headers.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_HEADERS } from '../../src/components/commander/shared/pageHeaders.js';
import nextConfig from '../../next.config.js';
import { assertProbeSecrets } from './probeSession';

const ROOT = join(__dirname, '..', '..');
// On the canonical repository a missing secret fails the run (probeSession.ts).
if (process.env.STAFF_HEADERS_FAKE_SESSION !== '1') assertProbeSecrets('staff-headers.spec.ts');
const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;
const FAKE = process.env.STAFF_HEADERS_FAKE_SESSION === '1';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
// Publishable key - it ships in the client bundle.
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable__41LpJpzrfrb3hSUpEaYCA_tF53bBJx';
const SHOTS = join(ROOT, 'test-results', 'staff-headers');
// Optional: only routes matching this regex (re-running one section by hand).
const ONLY = process.env.STAFF_HEADERS_ROUTES ? new RegExp(process.env.STAFF_HEADERS_ROUTES) : null;

/** SENSITIVE_ROUTES, read from the module that enforces it. */
function sensitiveRoutes(): string[] {
  const src = readFileSync(join(ROOT, 'vendor/commander-shared/src/lib/commander/auth.js'), 'utf8');
  const block = src.match(/export const SENSITIVE_ROUTES = \[([\s\S]*?)\];/);
  if (!block) throw new Error('SENSITIVE_ROUTES not found in the shared auth module');
  const list = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (list.length === 0) throw new Error('SENSITIVE_ROUTES parsed empty');
  return list;
}

/** Registry key -> next.config source pattern ([id] -> :id). */
const asSource = (route: string) => route.replace(/\[([^\]]+)\]/g, ':$1');

async function planRoutes() {
  const sensitive = sensitiveRoutes();
  const redirected = new Set((await nextConfig.redirects()).map((r: { source: string }) => r.source));
  const plan: { route: string; reason?: string }[] = [];
  for (const route of Object.keys(PAGE_HEADERS)) {
    if (sensitive.some((s) => route === s || route.startsWith(`${s}/`))) plan.push({ route, reason: 'PIN-gated (SENSITIVE_ROUTES)' });
    else if (/^\/commander\/admin(\/|$)/.test(route)) plan.push({ route, reason: 'admin PIN (middleware)' });
    else if (redirected.has(asSource(route))) plan.push({ route, reason: 'redirect (next.config.js)' });
    else plan.push({ route });
  }
  return plan;
}

async function passwordGrant(): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`password grant failed: ${res.status}`);
  const session = await res.json();
  if (!session?.access_token || !session?.user) throw new Error('grant returned no session');
  return session;
}

async function signIn(page: Page) {
  if (FAKE) {
    // Seeded before every navigation: the fake session is not server-signed,
    // so a page that validates it signs it out, and the next page would
    // otherwise be tested signed out.
    await page.context().addInitScript(() => {
      localStorage.setItem('commander_staff', JSON.stringify({
        id: 'probe', user_id: 'probe', venue_id: 1, role: 'owner',
        expires_at: new Date(Date.now() + 6 * 864e5).toISOString(),
      }));
      localStorage.setItem('commander_subscription', JSON.stringify({ tier: 'enterprise', status: 'active' }));
    });
    await page.goto('/api/health');
    return;
  }
  const session = await passwordGrant();
  await page.goto('/api/health');
  await page.evaluate((s) => {
    localStorage.setItem('smarter-poker-auth', JSON.stringify(s));
    localStorage.removeItem('commander_staff');
    sessionStorage.removeItem('commander_explicit_logout');
  }, session);
  await page.goto('/commander/login');
  await page.waitForURL(/\/commander\/dashboard/, { timeout: 45_000 });
  await expect(page.getByText(/your session is not valid/i)).toHaveCount(0);
  const staff = await page.evaluate(() => JSON.parse(localStorage.getItem('commander_staff') || 'null'));
  expect(staff?.sig, 'staff session must be server-signed').toBeTruthy();
}

/** Real ids for the dynamic routes, from the probe venue's own data. */
async function resolveIds(page: Page): Promise<Record<string, string | null>> {
  if (FAKE) return { id: null, tournamentId: null };
  return page.evaluate(async () => {
    const staff = JSON.parse(localStorage.getItem('commander_staff') || '{}');
    const auth = JSON.parse(localStorage.getItem('smarter-poker-auth') || '{}');
    const headers: Record<string, string> = { 'x-staff-session': localStorage.getItem('commander_staff') || '' };
    if (auth.access_token) headers.Authorization = `Bearer ${auth.access_token}`;
    const get = async (url: string) => {
      try { const r = await fetch(url, { headers }); return r.ok ? r.json() : null; } catch { return null; }
    };
    const venue = encodeURIComponent(staff.venue_id ?? '');
    const t = await get(`/api/commander/tournaments?venue_id=${venue}&limit=5`);
    const m = await get(`/api/commander/members?venue_id=${venue}&limit=1`);
    const tournament = t?.data?.tournaments?.[0]?.id;
    const member = m?.data?.members?.[0]?.id;
    return { tournamentId: tournament != null ? String(tournament) : null, id: member != null ? String(member) : null };
  });
}

function concretePath(route: string, ids: Record<string, string | null>): string | null {
  let missing = false;
  const path = route.replace(/\[([^\]]+)\]/g, (_, name) => {
    // /tournaments/[id] is a tournament id; /members/[id] is a member id.
    const value = name === 'id' && route.startsWith('/commander/tournaments/') ? ids.tournamentId : ids[name];
    if (!value) missing = true;
    return encodeURIComponent(value || '');
  });
  return missing ? null : path;
}

test.describe('signed-in staff pages', () => {
  test.skip(!FAKE && (!EMAIL || !PASSWORD),
    'PROBE_EMAIL / PROBE_PASSWORD secrets are not set on this repository: the signed-in staff header pass did not run');
  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough for a per-page header census');
  // One long census, not three: a retry would re-run every route.
  test.describe.configure({ timeout: 25 * 60_000, retries: 0 });

  test('every staff page shows its image header and exactly one painted "?"', async ({ page }, info) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    const ids = await resolveIds(page);
    const plan = await planRoutes();
    let visited = 0;

    for (const { route, reason } of plan) {
      if (ONLY && !ONLY.test(route)) continue;
    if (reason) { info.annotations.push({ type: 'excluded', description: `${route}: ${reason}` }); continue; }
      const path = concretePath(route, ids);
      if (!path) { info.annotations.push({ type: 'skipped', description: `${route}: no id available for the probe venue` }); continue; }

      await test.step(path, async () => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        const header = page.locator('[data-page-image-header]');
        await expect.soft(header, `${path}: image header`).toHaveCount(1, { timeout: 15_000 });
        await expect.soft(header.first(), `${path}: image header visible`).toBeVisible({ timeout: 5_000 });
        await expect.soft(page.locator('[data-page-help]'), `${path}: exactly one painted "?"`).toHaveCount(1, { timeout: 5_000 });
        if (!FAKE) await expect.soft(page.getByText(/your session is not valid/i), `${path}: session banner`).toHaveCount(0);
        const file = join(SHOTS, `${path.replace(/^\//, '').replace(/[^a-zA-Z0-9-]+/g, '_')}.png`);
        await page.screenshot({ path: file, fullPage: true });
        visited += 1;
      });
    }

    info.annotations.push({ type: 'visited', description: String(visited) });
    console.log(`[staff-headers] visited ${visited} staff routes; ${info.annotations.filter((a) => a.type !== 'visited').map((a) => `${a.type} ${a.description}`).join('; ')}`);
    if (!ONLY) expect(visited, 'too few staff routes were visited').toBeGreaterThan(40);
  });
});
