/**
 * SIGNED-IN STAFF HEADER CENSUS IS WIRED AND CANNOT PASS SILENTLY (2026-11-28)
 *
 * tests/e2e/staff-headers.spec.ts signs in as the probe account and opens
 * every staff page in production. A spec nobody runs proves nothing, so this
 * pins the wiring: the existing login-bridge-probe workflow's e2e job runs
 * it (no new workflow, no new schedule), it is not advisory, a missing secret
 * is announced rather than reported green, the screenshots are uploaded, and
 * the spec asserts what it claims.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('staff header census', () => {
  const wf = read('.github/workflows/login-bridge-probe.yml');
  const e2e = wf.slice(wf.indexOf('\n  e2e:'));
  const step = e2e.slice(e2e.indexOf('every staff page shows its #SmarterDesign header'), e2e.indexOf('Upload staff page screenshots'));

  it('runs in the existing e2e job of the existing workflow, with the probe secrets', () => {
    expect(step).toMatch(/npx playwright test tests\/e2e\/staff-headers\.spec\.ts --project=chromium/);
    expect(step).toMatch(/PLAYWRIGHT_TEST_EMAIL: \$\{\{ secrets\.PROBE_EMAIL \}\}/);
    expect(step).toMatch(/PLAYWRIGHT_TEST_PASSWORD: \$\{\{ secrets\.PROBE_PASSWORD \}\}/);
    expect(step).toMatch(/PLAYWRIGHT_BASE_URL: https:\/\/commander\.smarter\.poker/);
    const others = readdirSync(join(ROOT, '.github/workflows'))
      .filter((f) => f !== 'login-bridge-probe.yml')
      .filter((f) => read(`.github/workflows/${f}`).includes('staff-headers.spec'));
    expect(others, 'the census belongs to login-bridge-probe.yml only').toEqual([]);
  });

  it('adds no schedule and is never advisory', () => {
    expect(wf.match(/cron:/g)).toHaveLength(1);
    expect(wf).toMatch(/workflow_dispatch:/);
    expect(step).not.toMatch(/continue-on-error/);
  });

  it('says so when the secrets are missing instead of passing quietly', () => {
    expect(step).toMatch(/::notice title=Staff header census skipped::/);
    expect(step).toMatch(/GITHUB_STEP_SUMMARY/);
    const spec = read('tests/e2e/staff-headers.spec.ts');
    expect(spec).toMatch(/test\.skip\(!FAKE && \(!EMAIL \|\| !PASSWORD\),\s*'PROBE_EMAIL \/ PROBE_PASSWORD secrets are not set/);
  });

  it('uploads the screenshots', () => {
    const upload = e2e.slice(e2e.indexOf('Upload staff page screenshots'));
    expect(upload).toMatch(/actions\/upload-artifact@v4/);
    expect(upload).toMatch(/path: test-results\/staff-headers\//);
  });

  it('the spec asserts the header and exactly one painted "?" on every visited route', () => {
    const spec = read('tests/e2e/staff-headers.spec.ts');
    expect(spec).toMatch(/import \{ PAGE_HEADERS \} from '\.\.\/\.\.\/src\/components\/commander\/shared\/pageHeaders\.js'/);
    expect(spec).toMatch(/locator\('\[data-page-image-header\]'\)/);
    expect(spec).toMatch(/locator\('\[data-page-help\]'\)[^;]*toHaveCount\(1/);
    expect(spec).toMatch(/export const SENSITIVE_ROUTES = \\\[/);
    expect(spec).toMatch(/nextConfig\.redirects\(\)/);
    expect(spec).toMatch(/toBeGreaterThan\(40\)/);
    // SENSITIVE_ROUTES really is where the spec looks for it.
    expect(read('vendor/commander-shared/src/lib/commander/auth.js')).toMatch(/export const SENSITIVE_ROUTES = \[/);
  });
});

describe('the probe job outlives its own bounded deploy wait', () => {
  it('timeout-minutes covers 60 tries x (10 s sleep + 15 s curl) plus the probe', () => {
    const wf = read('.github/workflows/login-bridge-probe.yml');
    const probe = wf.slice(wf.indexOf('\n  probe:'), wf.indexOf('\n  e2e:'));
    const limit = Number(probe.match(/timeout-minutes: (\d+)/)[1]);
    expect(probe).toMatch(/for i in \$\(seq 1 60\)/);
    expect(probe).toMatch(/curl -s --max-time 15/);
    expect(probe).toMatch(/sleep 10/);
    expect(limit * 60).toBeGreaterThan(60 * (10 + 15) + 120);
    const e2e = wf.slice(wf.indexOf('\n  e2e:'));
    expect(Number(e2e.match(/timeout-minutes: (\d+)/)[1]) * 60).toBeGreaterThan(60 * 25 + 20 * 60);
  });
});
