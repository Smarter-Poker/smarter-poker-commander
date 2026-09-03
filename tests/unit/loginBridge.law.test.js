/**
 * LOGIN BRIDGE LAW - the Smarter.Poker -> Club Commander handshake may not
 * regress. Every pin below is a defect that actually shipped on 2026-09-03:
 *
 *   1. login.js called completeLogin() from every sign-in path while the
 *      function no longer existed in the file => "completeLogin is not
 *      defined" shown as the login error, nobody could sign in.
 *   2. login.js and auth/sso.js each kept their own copy of "finish the
 *      login" and drifted apart.
 *   3. commanderFetch announced a 401 (=> "Your Session Is Not Valid" +
 *      Sign In Again) without first re-minting a stale derived staff session
 *      from the still-valid platform session.
 *   4. smarter.poker/commander/* proxied Commander HTML whose /_next assets
 *      then 404'd on the hub origin => infinite spinner, the same-origin SSO
 *      path never ran.
 *   5. "Continue As Smarter.Poker" was a dead button on commander.smarter.poker
 *      (onClick undefined when the hub session is not in this origin's
 *      localStorage).
 *   6. check-subscription is the only issuer of the signed owner session; if
 *      it stops returning staff_session every login is unsigned => 401.
 *   7. CommanderLayout's club switcher hand-edited the signed session, which
 *      broke its HMAC and 401'd every request after a switch.
 *
 * These are STATIC checks on the source, so they run in CI with no browser and
 * no Supabase. If one turns red you have re-shipped the incident it names.
 * Fix your change; do not weaken the pin.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Strip comments so prose (like this header) can neither satisfy nor trip a
// pin. Strings are kept: several pins deliberately match literal values.
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const LOGIN = 'pages/commander/login.js';
const SSO = 'pages/auth/sso.js';
const FETCH = 'vendor/commander-shared/src/lib/commander/commanderFetch.js';
const SESSION = 'vendor/commander-shared/src/lib/commander/staffSession.js';
const SHIM = 'src/lib/commander/staffSession.js';
const CHECK_SUB = 'pages/api/check-subscription.js';
const NEXT_CONFIG = 'next.config.js';
const LAYOUT = 'vendor/commander-shared/src/components/commander/shared/CommanderLayout.jsx';

describe('login completion is defined and shared (pins 1 + 2)', () => {
  it('login.js defines every completeLogin it calls', () => {
    const src = code(read(LOGIN));
    const calls = (src.match(/[^\w.]completeLogin\s*\(/g) || []).length;
    const defined = /const\s+completeLogin\s*=|function\s+completeLogin\s*\(/.test(src);
    expect(calls, 'login.js must actually call completeLogin').toBeGreaterThan(0);
    expect(defined, 'completeLogin is called but never defined - this is the 2026-09-03 outage').toBe(true);
  });

  it('login.js and auth/sso.js both finish through the shared staffSession module', () => {
    for (const f of [LOGIN, SSO]) {
      const src = read(f);
      expect(src, `${f} must import completeCommanderLogin from src/lib/commander/staffSession`)
        .toMatch(/import\s*\{[^}]*\bcompleteCommanderLogin\b[^}]*\}\s*from\s*['"][./]*src\/lib\/commander\/staffSession['"]/);
      expect(code(src)).toMatch(/\bcompleteCommanderLogin\s*\(/);
    }
  });

  it('auth/sso.js no longer carries a private copy of the completion logic', () => {
    const src = code(read(SSO));
    expect(src).not.toMatch(/function\s+completeCommanderLogin\s*\(/);
    expect(src).not.toMatch(/localStorage\.setItem\(\s*['"]commander_staff['"]/);
  });

  it('the src shim is a pure re-export of the vendored module (vendor drift guard contract)', () => {
    const src = code(read(SHIM)).trim();
    expect(src).toMatch(/^export\s+\*\s+from\s*['"]@smarter-poker\/commander-shared\/lib\/commander\/staffSession['"];?$/);
  });

  it('the shared module exports the full contract the callers depend on', () => {
    const src = code(read(SESSION));
    for (const name of [
      'readStaffSession', 'isStaffSessionHealthy', 'readAccessToken', 'mintStaffSession',
      'storeCommanderSession', 'completeCommanderLogin', 'refreshStaffSession', 'consumeReturnUrl',
    ]) {
      expect(src, `staffSession must export ${name}`).toMatch(new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`));
    }
    // Vendored package is ESM and must stay dependency-free: no Supabase import,
    // no CommonJS (CHECK A of the vendor drift guard).
    expect(src).not.toMatch(/from\s*['"]@supabase/);
    expect(src).not.toMatch(/\bmodule\.exports\b|\brequire\s*\(/);
  });

  it('nobody hand-writes commander_staff outside the shared module', () => {
    // Only the shared module may write the signed session; a page that writes
    // its own unsigned copy is the drift that produced pin 2.
    for (const f of [LOGIN, SSO, FETCH]) {
      expect(code(read(f)), `${f} must not write commander_staff directly`)
        .not.toMatch(/localStorage\.setItem\(\s*['"]commander_staff['"]/);
    }
  });
});

describe('commanderFetch self-heals before it complains (pin 3)', () => {
  it('imports refreshStaffSession and retries once on 401 before announcing', () => {
    const src = code(read(FETCH));
    expect(src).toMatch(/import\s*\{[^}]*\brefreshStaffSession\b[^}]*\}\s*from\s*['"]\.\/staffSession['"]/);
    const refreshAt = src.indexOf('refreshStaffSession(');
    const announceAt = src.indexOf('announceUnauthorized(url)');
    expect(refreshAt, 'commanderFetch must call refreshStaffSession on 401').toBeGreaterThan(-1);
    expect(announceAt, 'commanderFetch must still announce a 401 it could not heal').toBeGreaterThan(-1);
    // The heal must run inside the fetch path BEFORE the announcement.
    const body = src.slice(src.indexOf('export async function commanderFetch'));
    expect(body.indexOf('refreshStaffSession(')).toBeLessThan(body.indexOf('announceUnauthorized('));
    expect(body).toMatch(/__commanderRetried/);
  });

  it('never fabricates a success for a 401 (the 2026-08-20 regression)', () => {
    const src = code(read(FETCH));
    expect(src).not.toMatch(/Club JAQK|venue_id:\s*['"]v1['"]/);
  });
});

describe('proxied pages load their own assets (pin 4)', () => {
  it('next.config pins assetPrefix to the commander origin in production', () => {
    const src = read(NEXT_CONFIG);
    expect(src).toMatch(/assetPrefix\s*:/);
    expect(src).toMatch(/https:\/\/commander\.smarter\.poker/);
    expect(src, 'assetPrefix must be production-only so preview builds stay self-consistent')
      .toMatch(/VERCEL_ENV\s*===\s*['"]production['"]/);
  });
});

describe('the SSO button is never dead (pin 5)', () => {
  it('Continue As Smarter.Poker always has a handler and can bridge cross-origin', () => {
    const src = code(read(LOGIN));
    expect(src, 'handler must be unconditional - not gated on ssoEmail').toMatch(/onClick=\{handleSSOContinue\}/);
    expect(src).not.toMatch(/onClick=\{ssoEmail\s*\?/);
    expect(read(LOGIN)).toMatch(/\/commander\/login\?bridge=1/);
    expect(src).toMatch(/router\.query\.bridge\s*===\s*['"]1['"]/);
  });

  it('the bridge only fires on the hub origin, so it can never loop', () => {
    const src = code(read(LOGIN));
    expect(src).toMatch(/router\.query\.bridge\s*===\s*['"]1['"]\s*&&\s*isHubOrigin\(\)/);
  });
});

describe('check-subscription issues the signed owner session (pin 6)', () => {
  it('signs with signStaffSession and returns staff_session', () => {
    const src = code(read(CHECK_SUB));
    expect(src).toMatch(/import\s*\{[^}]*\bsignStaffSession\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/src\/lib\/commander\/auth['"]/);
    expect(src).toMatch(/signStaffSession\s*\(\s*\{[\s\S]*?role:\s*['"]owner['"]/);
    expect(src).toMatch(/json\(\s*\{\s*subscription\s*,\s*staff_session\s*\}\s*\)/);
  });

  it('honours preferred_venue_id (club switcher + self-heal depend on it)', () => {
    expect(code(read(CHECK_SUB))).toMatch(/preferred_venue_id/);
  });

  it('keeps the per-IP limit high enough for a room full of phones behind one NAT', () => {
    const m = code(read(CHECK_SUB)).match(/checkMemoryRateLimit\(\s*`chksub:\$\{ip\}`\s*,\s*(\d+)/);
    expect(m, 'per-IP limiter must exist').toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(30);
  });
});

describe('CommanderLayout never invalidates or abandons a live session (pin 7)', () => {
  it('the club switcher asks the server for a signed session instead of editing the signed payload', () => {
    const src = code(read(LAYOUT));
    const fn = src.slice(src.indexOf('const switchAccount'), src.indexOf('const [showClubPagePopup'));
    expect(fn.length, 'switchAccount must exist').toBeGreaterThan(50);
    expect(fn, 'switchAccount must mint via the server').toMatch(/mintStaffSession\s*\(/);
    expect(fn, 'switchAccount must pass the chosen venue').toMatch(/preferredVenueId:\s*account\.venue_id/);
    // The 2026-09-03 bug: spreading the stored session and overwriting venue_id/role
    // broke its HMAC and 401'd every request that followed.
    expect(fn).not.toMatch(/\.\.\.currentStaff/);
    expect(fn).not.toMatch(/localStorage\.setItem\(\s*['"]commander_staff['"]/);
  });

  it('a 401 announcement triggers a forced re-mint before the banner is shown', () => {
    const src = code(read(LAYOUT));
    const fn = src.slice(src.indexOf('const onUnauthorized'), src.indexOf("window.addEventListener('commander:unauthorized'"));
    expect(fn).toMatch(/refreshStaffSession\(\s*\{\s*force:\s*true\s*\}\s*\)/);
    expect(fn.indexOf('refreshStaffSession(')).toBeLessThan(fn.indexOf('setUnauthorized(true)'));
  });

  it('a stale-looking session is refreshed on mount, before the first data request', () => {
    const src = code(read(LAYOUT));
    expect(src).toMatch(/if\s*\(stored\s*&&\s*!isStaffSessionHealthy\(\)\)\s*\{\s*refreshStaffSession\(\)/);
  });
});

// ── 2026-09-03 hardening pass: the guards that keep the guards honest ────────

describe('one auth authority (pin 8)', () => {
  it('middleware only gates the admin PIN and never builds a second Supabase client', () => {
    const src = code(read('middleware.ts'));
    expect(src).not.toMatch(/@supabase\/ssr|createServerClient|auth\.getUser|auth\.getSession/);
    expect(src).toMatch(/verifyPinSession/);
    expect(src, 'matcher must be scoped to admin paths, not the whole app').toMatch(/matcher:\s*\[\s*'\/commander\/admin\/:path\*'/);
  });

  it('every guarded client fetch goes through commanderFetch (self-heal)', () => {
    const branding = code(read('vendor/commander-shared/src/lib/commander/useClubBranding.js'));
    expect(branding).toMatch(/commanderFetch\('\/api\/commander\/settings'\)/);
    expect(branding).not.toMatch(/\bfetch\('\/api\/commander\/settings'/);
    const layout = code(read(LAYOUT));
    expect(layout).toMatch(/commanderFetch\('\/api\/my-commander-accounts'\)/);
    expect(layout).not.toMatch(/[^r]fetch\('\/api\/my-commander-accounts'\)/);
  });
});

describe('the lint that would have caught the outage is blocking (pin 9)', () => {
  it('package.json wires lint:undef into npm test and CI runs it without continue-on-error', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['lint:undef']).toMatch(/eslint --config eslint\.undef\.config\.mjs/);
    expect(pkg.scripts.test).toMatch(/^npm run lint:undef && /);
    const ci = read('.github/workflows/ci.yml');
    const step = ci.slice(ci.indexOf('Undefined identifiers (blocking)'), ci.indexOf('- name: Lint\n'));
    expect(step).toMatch(/run: npm run lint:undef/);
    expect(step).not.toMatch(/continue-on-error/);
  });

  it('the undef config enforces no-undef and nothing weaker', () => {
    const cfg = read('eslint.undef.config.mjs');
    expect(cfg).toMatch(/'no-undef':\s*'error'/);
    expect(cfg).not.toMatch(/'no-undef':\s*'(warn|off)'/);
  });

  it('the two ReferenceErrors the gate found stay fixed', () => {
    for (const f of ['pages/api/tournaments/[id]/entries/[entryId]/pay.js', 'pages/api/tournaments/[id]/reconciliation.js']) {
      const src = code(read(f));
      // Helper functions have no `res`; the refusal must be returned as data.
      expect(src, `${f} must not call denyCrossVenue(res) outside the handler`).not.toMatch(/denyCrossVenue\(res/);
      expect(src).toMatch(/isSameVenue\(staff, tournament\)/);
    }
    for (const f of ['vendor/commander-shared/src/components/commander/admin/MultiVenueDashboard.jsx', 'vendor/commander-shared/src/components/commander/analytics/AnalyticsDashboard.jsx']) {
      expect(code(read(f))).not.toMatch(/\bIsNegative\b/);
    }
  });
});

describe('the outage would be visible (pin 10)', () => {
  it('client Sentry is actually loaded and the auth-flow monitor is installed', () => {
    const app = code(read('pages/_app.js'));
    expect(app).toMatch(/require\('\.\.\/sentry\.client\.config'\)/);
    expect(app).toMatch(/installAuthFlowMonitor\(\)/);
    const mon = code(read('src/lib/authFlowMonitor.js'));
    for (const ev of ['commander.auth.reference_error', 'commander.auth.login_failed', 'commander.auth.unauthorized']) {
      expect(mon).toContain(ev);
    }
    for (const f of [LOGIN, SSO]) expect(code(read(f))).toMatch(/reportLoginFailure\(/);
  });

  it('server/edge Sentry configs are loaded through instrumentation.js', () => {
    const inst = code(read('instrumentation.js'));
    expect(inst).toMatch(/sentry\.server\.config/);
    expect(inst).toMatch(/sentry\.edge\.config/);
    expect(read(NEXT_CONFIG)).toMatch(/instrumentationHook:\s*true/);
  });

  it('/api/health exposes the booleans the probe asserts (never values)', () => {
    const h = code(read('pages/api/health.js'));
    expect(h).toMatch(/sentry_client_dsn:\s*Boolean\(/);
    expect(h).toMatch(/staff_session_secret:\s*Boolean\(/);
    expect(h).not.toMatch(/process\.env\.[A-Z_]+\s*,?\s*\n?\s*\}/); // no raw env value in the payload
  });
});

describe('production is watched (pin 11)', () => {
  it('the probe script and its 30-minute workflow exist and cover both legs', () => {
    const probe = read('scripts/probe-login-bridge.mjs');
    for (const s of ['/commander/login', '/auth/sso', '/api/auth/sso-exchange', '/api/commander/check-subscription', '/api/auth/commander-sso', '/api/health', 'completeLogin(', 'x-staff-session']) {
      expect(probe, `probe must check ${s}`).toContain(s);
    }
    const wf = read('.github/workflows/login-bridge-probe.yml');
    expect(wf).toMatch(/cron: '7,37 \* \* \* \*'/);
    expect(wf).toMatch(/node scripts\/probe-login-bridge\.mjs/);
    expect(wf).toMatch(/login-bridge-probe/); // the issue label
    expect(wf).toMatch(/playwright test tests\/e2e\/login-bridge\.spec\.ts/);
  });

  it('the Playwright spec covers the outage shapes', () => {
    const spec = read('tests/e2e/login-bridge.spec.ts');
    for (const s of ['bridge', 'ReferenceError', '/auth/sso?token=', 'expired=1', 'commander_staff', 'tampered']) {
      expect(spec).toContain(s);
    }
  });
});
