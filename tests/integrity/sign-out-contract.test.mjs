/**
 * SIGN-OUT CONTRACT — both headers, one behaviour.
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026-09-04. Commander ships TWO hamburger drawers and they disagreed.
 *
 *   - CommanderLayout (vendor/commander-shared) — 25 nav items and a Sign Out.
 *   - StandaloneGlobalHeader (src/) — mounted by pages/_app.js on the 29 routes
 *     in COMMANDER_ROUTES_WITHOUT_SHARED_LAYOUT, including the waitlist desk,
 *     the kiosk, the lobby and every report. It had NO sign-out control at all.
 *
 * The one that existed was not safe either:
 *   - `try { await supabase.auth.signOut(); } catch {}` cannot see failure.
 *     GoTrue resolves with { error } rather than throwing for anything that is
 *     not 401/403/404, and on that path returns before _removeSession(), so the
 *     session in localStorage survives.
 *   - It never removed `smarter-poker-auth` itself, only the commander_* keys.
 *   - login.js then silently signed the user back in from the surviving session
 *     and bounced to the dashboard: a flash, then no logout.
 *   - The HttpOnly `commander_admin_session` PIN cookie outlived the logout by
 *     up to 30 minutes. /api/admin/pin-logout existed with zero callers.
 *
 * CommanderLayout lives in vendor/ and must not import app code, so it carries
 * its own copy of the clear. This test is what stops the two drifting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const LAYOUT = read('vendor/commander-shared/src/components/commander/shared/CommanderLayout.jsx');
const STANDALONE = read('src/components/commander/shared/StandaloneGlobalHeader.jsx');
const HELPER = read('src/lib/commanderLogout.js');
const LOGIN = read('pages/commander/login.js');

/** Keys no sign-out may leave behind, whichever header the user is looking at. */
const REQUIRED_CLEARED = [
  'smarter-poker-auth',        // the platform session itself
  'commander_staff',
  'commander_venue',
  'commander_subscription',
  'commander_active_venue_id', // else the next operator inherits the venue
];

test('both drawers offer a Sign Out', () => {
  assert.match(LAYOUT, /Sign Out/,
    'CommanderLayout must keep its Sign Out row');
  assert.match(STANDALONE, /Sign Out/,
    'StandaloneGlobalHeader must offer Sign Out. It is the only header on the ' +
      '29 routes in COMMANDER_ROUTES_WITHOUT_SHARED_LAYOUT; without it an ' +
      'operator on the waitlist desk or kiosk cannot sign out at all.');
});

test('every sign-out path clears the same keys', () => {
  for (const key of REQUIRED_CLEARED) {
    assert.ok(LAYOUT.includes(`'${key}'`),
      `CommanderLayout.handleLogout must clear ${key}`);
    assert.ok(HELPER.includes(`'${key}'`),
      `commanderLogout must clear ${key}`);
  }
});

test('the sb-*-auth-token keys go too', () => {
  for (const [name, src] of [['CommanderLayout', LAYOUT], ['commanderLogout', HELPER]]) {
    assert.match(src, /startsWith\('sb-'\)/,
      `${name} must sweep the sb-*-auth-token keys GoTrue may have left behind`);
  }
});

/** Block comments quote the old broken code on purpose; never match on those. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

test('signOut failure is read, not assumed away', () => {
  for (const [name, src] of [['CommanderLayout', LAYOUT], ['commanderLogout', HELPER]]) {
    const code = stripComments(src);
    assert.match(code, /auth\??\.signOut\(\)/, `${name} must call signOut`);
    assert.match(
      code,
      /const\s*\{\s*error\s*\}\s*=\s*\(await\s+\w+\??\.auth\??\.signOut\(\)\)/,
      `${name} must read signOut's { error } return value. A bare try/catch ` +
        'never fires: GoTrue resolves rather than throws for offline/5xx/429, ' +
        'and on that path returns before _removeSession() — the session survives.'
    );
    assert.doesNotMatch(
      code,
      /try\s*\{\s*await\s+supabase\.auth\.signOut\(\);\s*\}\s*catch/,
      `${name} must not restore the fire-and-forget signOut`
    );
  }
});

test('the server-side PIN grant is revoked on sign-out', () => {
  for (const [name, src] of [['CommanderLayout', LAYOUT], ['commanderLogout', HELPER]]) {
    assert.match(src, /\/api\/commander\/admin\/pin-logout/,
      `${name} must POST /api/commander/admin/pin-logout. commander_admin_session ` +
        'is HttpOnly with a 30-minute TTL, so only the server can clear it — and ' +
        'on a shared floor terminal it let the next person into /commander/admin/*.');
  }
  assert.doesNotMatch(LAYOUT, /fetch\('\/api\/admin\/pin-logout'/,
    'use the /api/commander/* prefix: it resolves on both origins, a bare ' +
      '/api/* 404s when Commander is served through smarter.poker');
});

test('an explicit sign-out defeats the login page silent sign-in', () => {
  assert.match(LAYOUT, /commander_explicit_logout/,
    'handleLogout must set the marker');
  assert.match(HELPER, /commander_explicit_logout/,
    'the shared helper must set the marker');
  assert.match(LOGIN, /commander_explicit_logout/,
    'login.js must honour the marker before its silent sign-in, or a surviving ' +
      'Supabase session re-mints the staff session and bounces to the dashboard');
  const i = LOGIN.indexOf('commander_explicit_logout');
  const j = LOGIN.indexOf('-- Silent sign-in whenever a Supabase session exists --');
  assert.ok(i !== -1 && j !== -1 && i < j,
    'the marker check must run BEFORE the silent sign-in block');
  assert.match(LOGIN, /removeItem\('commander_explicit_logout'\)/,
    'the marker must be consumed once, never left to wedge a user out');
});

test('neither sign-out can fire twice', () => {
  assert.match(LAYOUT, /signingOutRef/, 'CommanderLayout must latch');
  assert.match(STANDALONE, /signingOutRef/, 'StandaloneGlobalHeader must latch');
});

test('cross-origin API calls use the /api/commander prefix', () => {
  // next.config.js rewrites /api/commander/:path* -> /api/:path* on this origin,
  // and the World Hub's vercel.json forwards the same prefix. A bare /api/* path
  // 404s whenever Commander is reached through smarter.poker — which is how
  // `Switch Account` silently vanished for multi-club owners on the main domain.
  assert.doesNotMatch(LAYOUT, /commanderFetch\('\/api\/my-commander-accounts'\)/,
    'use /api/commander/my-commander-accounts');
  assert.match(LAYOUT, /commanderFetch\('\/api\/commander\/my-commander-accounts'\)/);
});
