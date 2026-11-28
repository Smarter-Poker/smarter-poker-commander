/**
 * SIGNED-IN PLAYER PAGE CENSUS AND BUSINESS-DATE CHECK ARE WIRED AND CANNOT
 * PASS SILENTLY (2026-11-28)
 *
 * tests/e2e/player-pages.spec.ts opens every World Hub /hub/commander page
 * signed in as the probe; tests/e2e/business-date.spec.ts reads the server's
 * business date back from production. This pins the wiring: both run in the
 * existing e2e job of login-bridge-probe.yml (no new workflow, no new
 * schedule), never advisory, never retried, the route list comes from the
 * World Hub source, a missing secret on the canonical repo is a failure,
 * screenshots upload before the next spec empties test-results/, and the
 * specs assert what they claim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const wf = read('.github/workflows/login-bridge-probe.yml');
const e2e = wf.slice(wf.indexOf('\n  e2e:'));
const between = (a, b) => e2e.slice(e2e.indexOf(a), e2e.indexOf(b, e2e.indexOf(a)));
const playerStep = between('every World Hub player page shows its headers', 'Upload player page screenshots');
const dateStep = between('the business date is the venue-local date', 'Upload traces on failure');

describe('player page census and business-date check', () => {
  it('run in the existing e2e job only, with the probe secrets, no retries', () => {
    expect(playerStep).toMatch(/npx playwright test tests\/e2e\/player-pages\.spec\.ts --project=chromium --retries=0/);
    expect(dateStep).toMatch(/npx playwright test tests\/e2e\/business-date\.spec\.ts --project=chromium --retries=0/);
    for (const step of [playerStep, dateStep]) {
      expect(step).toMatch(/PLAYWRIGHT_TEST_EMAIL: \$\{\{ secrets\.PROBE_EMAIL \}\}/);
      expect(step).toMatch(/PLAYWRIGHT_TEST_PASSWORD: \$\{\{ secrets\.PROBE_PASSWORD \}\}/);
      expect(step).not.toMatch(/continue-on-error/);
      expect(step).toMatch(/status=\$\{PIPESTATUS\[0\]\}/);
      expect(step).toMatch(/exit "\$status"/);
    }
    const others = readdirSync(join(ROOT, '.github/workflows'))
      .filter((f) => f !== 'login-bridge-probe.yml')
      .filter((f) => /player-pages\.spec|business-date\.spec/.test(read(`.github/workflows/${f}`)));
    expect(others).toEqual([]);
    expect(wf.match(/cron:/g)).toHaveLength(1);
  });

  it('a missing secret fails on the canonical repository and is a notice on a fork', () => {
    for (const step of [playerStep, dateStep]) {
      expect(step).toMatch(/PROBE_SECRETS_REQUIRED: \$\{\{ github\.repository == 'Smarter-Poker\/smarter-poker-commander' \}\}/);
      expect(step).toMatch(/::error title=/);
      expect(step).toMatch(/::notice title=/);
    }
    const session = read('tests/e2e/probeSession.ts');
    expect(session).toMatch(/PROBE_SECRETS_REQUIRED === 'true'/);
    expect(session).toMatch(/throw new Error/);
    for (const spec of ['player-pages', 'business-date', 'staff-headers']) {
      expect(read(`tests/e2e/${spec}.spec.ts`)).toMatch(/assertProbeSecrets\('/);
    }
  });

  it('the route list is the World Hub source, checked out in the job', () => {
    const checkout = between('Check out the World Hub player page list', 'every World Hub player page shows');
    expect(checkout).toMatch(/repository: Smarter-Poker\/Smarter-Poker-World-Hub/);
    expect(checkout).toMatch(/sparse-checkout: pages\/hub\/commander/);
    expect(playerStep).toMatch(/HUB_COMMANDER_PAGES_DIR: \$\{\{ github\.workspace \}\}\/world-hub\/pages\/hub\/commander/);
  });

  it('screenshots upload before the next spec empties test-results/', () => {
    const order = ['staff-headers.spec.ts', 'path: test-results/staff-headers/', 'player-pages.spec.ts',
      'path: test-results/player-pages/', 'business-date.spec.ts'].map((m) => e2e.indexOf(m));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the player spec asserts one global header, one image header, one painted "?", no errors, a minimum count', () => {
    const spec = read('tests/e2e/player-pages.spec.ts');
    expect(spec).toMatch(/locator\('\.approved-global-header'\)[^;]*toHaveCount\(1/);
    expect(spec).toMatch(/locator\('header\.cmd-header-full, header\.cmd-header-bar'\)/);
    expect(spec).toMatch(/locator\('\.sd-header-help'\)/);
    expect(spec).toMatch(/'\/hub\/commander\/home-games\/join', '\/hub\/commander\/tournament\/\[id\]\/clock'/);
    expect(spec).toMatch(/page\.on\('pageerror'/);
    expect(spec).toMatch(/Application error/);
    expect(spec).toMatch(/width: 393/);
    expect(spec).toMatch(/width: 1280/);
    expect(spec).toMatch(/const MIN_VISITED = (\d+)/);
    expect(Number(spec.match(/const MIN_VISITED = (\d+)/)[1])).toBeGreaterThanOrEqual(26);
    expect(spec).toMatch(/toBeGreaterThanOrEqual\(MIN_VISITED\)/);
    expect(spec).toMatch(/retries: 0/);
  });

  it('every failed assertion reaches one annotation, readable without log access', () => {
    expect(read('tests/e2e/player-pages.spec.ts')).toMatch(/\[player-pages\] FAILURES \(/);
    expect(playerStep).toMatch(/::error title=Player page census failures::/);
  });

  it('the business-date spec compares the server answer with Intl in the venue zone', () => {
    const spec = read('tests/e2e/business-date.spec.ts');
    expect(spec).toMatch(/\/api\/reports\/daily\?venue_id=/);
    expect(spec).toMatch(/new Intl\.DateTimeFormat\('en-US', \{ timeZone/);
    expect(spec).toMatch(/toContain\(serverDate\)/);
    expect(spec).toMatch(/not\.toBe\(utc\[0\]\)/);
    // The route it reads really defaults to the venue business date.
    const route = read('pages/api/reports/daily.js');
    expect(route).toMatch(/const reportDate = isDateKey\(date\) \? date : businessDateKey\(new Date\(\), timeZone\)/);
    expect(route).toMatch(/fetchVenueTimeZone\(/);
    expect(route).toMatch(/guardStaff\(req, res\)/);
  });
});
