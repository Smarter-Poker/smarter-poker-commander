/**
 * Login bridge - end-to-end, in a real browser.
 *
 * Covers what the 2026-09-03 outage looked like to a human:
 *   - the login page renders and its JavaScript actually runs (the hub-origin
 *     proxy used to spin forever because its chunks 404'd)
 *   - "Continue As Smarter.Poker" is a live button on the commander origin and
 *     hops to the hub bridge (?bridge=1) when nothing is signed in
 *   - a stale SSO link fails loudly with "Sign In Manually", not a spinner
 *   - ?expired=1 with no session shows the form, not an exception
 *   - a wrong password produces a login error and NOT a ReferenceError
 *   - [signed-in, when PLAYWRIGHT_TEST_EMAIL/PASSWORD are set] the full
 *     password -> check-subscription -> dashboard flow lands on the dashboard
 *     with no "Session Is Not Valid" banner, and a hand-tampered staff session
 *     self-heals on reload instead of bouncing to login.
 *
 * Base URL: PLAYWRIGHT_BASE_URL (CI points it at production; locally it is the
 * dev server on :3001). The hub origin is PLAYWRIGHT_HUB_ORIGIN
 * (default https://smarter.poker).
 */
import { test, expect, type Page } from '@playwright/test';

const HUB = process.env.PLAYWRIGHT_HUB_ORIGIN || 'https://smarter.poker';
const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;

function collectReferenceErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => { if (err.name === 'ReferenceError') errors.push(err.message); });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /is not defined/.test(msg.text())) errors.push(msg.text());
  });
  return errors;
}

test.describe('login page (signed out)', () => {
  test('renders and runs its JavaScript', async ({ page }) => {
    const refErrors = collectReferenceErrors(page);
    const failedChunks: string[] = [];
    page.on('response', (res) => {
      if (res.url().includes('/_next/static/') && res.status() >= 400) failedChunks.push(`${res.status()} ${res.url()}`);
    });

    await page.goto('/commander/login');
    // Hydration proof: the SSO button is rendered by React, not by static HTML.
    await expect(page.getByRole('button', { name: /continue as/i })).toBeVisible({ timeout: 15_000 });
    expect(failedChunks, 'every Next.js chunk must load').toEqual([]);
    expect(refErrors).toEqual([]);
  });

  test('"Continue As Smarter.Poker" is live and bridges to the hub when nothing is signed in', async ({ page, baseURL }) => {
    await page.goto('/commander/login');
    const btn = page.getByRole('button', { name: /continue as/i });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await expect(btn).toBeEnabled();

    const isHubOrigin = new URL(baseURL!).origin === new URL(HUB).origin;
    await btn.click();
    if (!isHubOrigin) {
      // Signed out on the commander origin => must hop to the hub bridge...
      await page.waitForURL((u) => u.origin === new URL(HUB).origin && u.searchParams.get('bridge') === '1', { timeout: 20_000 });
      // ...which, with no hub session either, renders the form (no loop, no spinner).
      await expect(page.getByRole('button', { name: /continue as/i })).toBeVisible({ timeout: 20_000 });
      expect(page.url()).toContain('bridge=1');
    } else {
      await expect(page.getByText(/not signed in to smarter\.poker/i)).toBeVisible({ timeout: 15_000 });
    }
  });

  test('a stale SSO link fails loudly, not with a spinner', async ({ page }) => {
    await page.goto(`/auth/sso?token=${'0'.repeat(64)}&uid=00000000-0000-0000-0000-000000000000`);
    await expect(page.getByText(/sign-in failed/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: /sign in manually/i })).toBeVisible();
  });

  test('?expired=1 without a session shows the form with a clear message', async ({ page }) => {
    const refErrors = collectReferenceErrors(page);
    await page.goto('/commander/login?expired=1');
    await expect(page.getByText(/session has expired/i)).toBeVisible({ timeout: 20_000 });
    expect(refErrors).toEqual([]);
  });

  test('a wrong password yields a login error, never a ReferenceError', async ({ page }) => {
    const refErrors = collectReferenceErrors(page);
    await page.goto('/commander/login');
    await expect(page.getByRole('button', { name: /continue as/i })).toBeVisible({ timeout: 15_000 });
    await page.locator('input[type="email"]').fill('probe-nobody@smarter.poker');
    await page.locator('input[type="password"]').fill('definitely-not-the-password');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    // Any visible error text is fine; what must NOT appear is the outage.
    const err = page.locator('text=/invalid|credentials|failed|could not/i').first();
    await expect(err).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/is not defined/i)).toHaveCount(0);
    expect(refErrors).toEqual([]);
  });
});

test.describe('signed-in flow', () => {
  test.skip(!EMAIL || !PASSWORD, 'PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD not set');

  test('password login lands on the dashboard with no session banner, and a tampered staff session self-heals', async ({ page }) => {
    const refErrors = collectReferenceErrors(page);
    await page.goto('/commander/login');
    await expect(page.getByRole('button', { name: /continue as/i })).toBeVisible({ timeout: 15_000 });
    await page.locator('input[type="email"]').fill(EMAIL!);
    await page.locator('input[type="password"]').fill(PASSWORD!);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await page.waitForURL(/\/commander\/dashboard/, { timeout: 30_000 });
    await expect(page.getByText(/your session is not valid/i)).toHaveCount(0);
    expect(refErrors).toEqual([]);

    const staff = await page.evaluate(() => JSON.parse(localStorage.getItem('commander_staff') || 'null'));
    expect(staff?.sig, 'staff session must be server-signed').toBeTruthy();
    expect(staff?.session_ts).toBeTruthy();

    // Break the signature the way the old club switcher did, then reload.
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('commander_staff') || '{}');
      s.sig = 'tampered';
      localStorage.setItem('commander_staff', JSON.stringify(s));
    });
    await page.reload();
    await expect(page).toHaveURL(/\/commander\/dashboard/, { timeout: 30_000 });
    // Give the mount-time refresh a moment, then assert it re-minted.
    await expect.poll(async () => {
      const s = await page.evaluate(() => JSON.parse(localStorage.getItem('commander_staff') || '{}'));
      return s.sig;
    }, { timeout: 20_000 }).not.toBe('tampered');
    await expect(page.getByText(/your session is not valid/i)).toHaveCount(0);
    expect(page.url()).not.toContain('/commander/login');
  });
});
