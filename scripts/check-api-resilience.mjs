#!/usr/bin/env node
/**
 * NO STAFF PAGE WHITE-SCREENS ON A BAD API ANSWER (2026-11-28)
 *
 * Opens every route in src/components/commander/shared/pageHeaders.js against
 * a running build (`next start`), with every /api/** answer replaced by one
 * of these, in turn:
 *   empty-array   200 {"success":true,"data":[]}
 *   empty-object  200 {}
 *   null-data     200 {"success":true,"data":null}
 *   error-body    200 {"success":false,"error":"x"}
 *   http-500      500 {"error":"x"}
 *   http-401      401 {"error":"x"}
 * A page passes when the browser raised no uncaught page error and the page
 * drew its #SMARTERDESIGN image header ([data-page-image-header]), or the PIN
 * gate, or (401 only) left for sign-in. Before this check nine staff pages
 * crashed to "Application error" on at least one of these, because they read
 * `x.y.z` straight off the response, and four Tournament Director screens
 * drew their error state without the layout (no header, no way back but one
 * button).
 *
 * Usage (CI runs it in the required build job, after `next start`):
 *   COMMANDER_ORIGIN=http://127.0.0.1:3199 node scripts/check-api-resilience.mjs
 * Options: RESILIENCE_ROUTES=<regex>, RESILIENCE_MODES=empty-object,http-500,
 *   CHROME_PATH=/usr/bin/google-chrome (default: the system Chrome when present,
 *   else Playwright's own Chromium).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = process.env.COMMANDER_ORIGIN || 'http://127.0.0.1:3199';
const ONLY = process.env.RESILIENCE_ROUTES ? new RegExp(process.env.RESILIENCE_ROUTES) : null;

export const MODES = {
  'empty-array': { status: 200, body: { success: true, data: [] } },
  'empty-object': { status: 200, body: {} },
  'null-data': { status: 200, body: { success: true, data: null } },
  'error-body': { status: 200, body: { success: false, error: 'x' } },
  'http-500': { status: 500, body: { error: 'x' } },
  'http-401': { status: 401, body: { error: 'x' } },
};
const modes = (process.env.RESILIENCE_MODES || Object.keys(MODES).join(',')).split(',');

const registry = readFileSync(`${ROOT}/src/components/commander/shared/pageHeaders.js`, 'utf8');
const routes = [...registry.matchAll(/^ {2}'(\/commander\/[^']+)': \{/gm)].map((m) => m[1]).filter((r) => !ONLY || ONLY.test(r));
if (routes.length < 80 && !ONLY) throw new Error(`registry parsed ${routes.length} routes`);

const concrete = (route) => route.replace('[tournamentId]', 't1').replace('[id]', 'probe-id');

function launchOptions() {
  const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean);
  const executablePath = candidates.find((p) => existsSync(p));
  return { args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) };
}

async function visit(ctx, route, mode) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 160)));
  // React reports a render crash through console.error, not as a page error.
  page.on('console', (m) => {
    if (m.type() === 'error' && /TypeError|ReferenceError|is not a function|Cannot read|undefined is not|Minified React error/.test(m.text())) errors.push(m.text().split('\n')[0].slice(0, 160));
  });
  try {
    await page.goto(ORIGIN + concrete(route), { waitUntil: 'load', timeout: 45000 });
  } catch (e) {
    errors.push(`navigation: ${e.message.split('\n')[0]}`);
  }
  // A page settles when it draws its header, the PIN gate, or sign-in.
  const settled = page.locator('[data-page-image-header], [data-pin-gate], input[type="password"]');
  await settled.first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500); // late fetches that throw after first paint
  const url = page.url();
  const header = await page.locator('[data-page-image-header]').count();
  const pinGate = /\/commander\/admin\/pin-entry/.test(url) || (await page.getByText(/Enter An Authorized PIN/i).count()) > 0;
  const signIn = mode === 'http-401' && /\/commander\/login/.test(url);
  const crashed = (await page.getByText(/Application error: a client-side exception/i).count()) > 0;
  const text = header ? '' : (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 140);
  await page.close();
  const ok = errors.length === 0 && !crashed && (header > 0 || pinGate || signIn);
  return { route, mode, ok, header, pinGate, signIn, crashed, url: url.replace(ORIGIN, ''), errors, text };
}

async function main() {
  const browser = await chromium.launch(launchOptions());
  const failures = [];
  let runs = 0;
  for (const mode of modes) {
    const answer = MODES[mode];
    if (!answer) throw new Error(`unknown mode ${mode}`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('commander_staff', JSON.stringify({ id: 'probe', user_id: 'probe', venue_id: 1, role: 'owner', expires_at: new Date(Date.now() + 5e8).toISOString(), venue_name: 'Probe Club' }));
      localStorage.setItem('commander_subscription', JSON.stringify({ tier: 'enterprise', status: 'active' }));
      localStorage.setItem('commander_venue_id', '1');
      localStorage.setItem('commander_security_gate', 'off');
      const user = { id: 'probe', email: 'probe@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: {} };
      localStorage.setItem('smarter-poker-auth', JSON.stringify({ access_token: 'probe.probe.probe', refresh_token: 'probe', token_type: 'bearer', expires_in: 432000, expires_at: Math.floor(Date.now() / 1000) + 432000, user }));
    });
    const user = { id: 'probe', email: 'probe@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: {} };
    await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
    await ctx.route('**/rest/v1/**', (r) => r.fulfill({ status: answer.status === 200 ? 200 : answer.status, contentType: 'application/json', body: answer.status === 200 ? '[]' : JSON.stringify({ message: 'x' }) }));
    await ctx.route('**/realtime/v1/**', (r) => r.abort());
    await ctx.route(`${ORIGIN}/api/**`, (r) => r.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) }));
    const queue = [...routes];
    const worker = async () => {
      while (queue.length) {
        const route = queue.shift();
        const res = await visit(ctx, route, mode);
        runs += 1;
        if (!res.ok) failures.push(res);
      }
    };
    await Promise.all(Array.from({ length: Number(process.env.RESILIENCE_CONCURRENCY || 3) }, worker));
    await ctx.close();
  }
  await browser.close();
  for (const f of failures) {
    console.log(`FAIL ${f.mode.padEnd(12)} ${f.route} -> ${f.url} header=${f.header} crashed=${f.crashed} ${f.errors.join(' | ')}${f.text ? ` text: ${f.text}` : ''}`);
  }
  console.log(`[api-resilience] ${runs} page loads, ${failures.length} failed (${routes.length} routes x ${modes.length} answers)`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
