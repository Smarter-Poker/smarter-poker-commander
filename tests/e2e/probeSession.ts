/**
 * The probe identity for the signed-in live checks (2026-11-28).
 *
 * The signed-in specs (staff-headers, player-pages, business-date) sign in as
 * the probe account and nothing else: PROBE_EMAIL / PROBE_PASSWORD, the
 * GitHub secrets on this repository, handed to Playwright as
 * PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD. Never a personal account,
 * never a value read from an env file.
 *
 * WHEN THE SECRETS ARE MISSING
 * On a fork (or a local run) the secrets do not exist, and the specs skip
 * with a notice that says so. On the canonical repository the workflow sets
 * PROBE_SECRETS_REQUIRED=true: there a missing secret means the signed-in
 * check silently stopped checking, so `assertProbeSecrets()` throws and the
 * run goes red instead of skipping to green.
 */
import type { Page } from '@playwright/test';

export const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
export const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;
export const HAVE_PROBE_SECRETS = !!(EMAIL && PASSWORD);
export const PROBE_SECRETS_REQUIRED = process.env.PROBE_SECRETS_REQUIRED === 'true';
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
// Publishable key - it ships in the client bundle.
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable__41LpJpzrfrb3hSUpEaYCA_tF53bBJx';

/** Throws when this run is expected to be signed in and cannot be. */
export function assertProbeSecrets(spec: string) {
  if (PROBE_SECRETS_REQUIRED && !HAVE_PROBE_SECRETS) {
    throw new Error(`${spec}: PROBE_SECRETS_REQUIRED is true but PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD are empty. `
      + 'The PROBE_EMAIL / PROBE_PASSWORD secrets are missing on the canonical repository, so the signed-in live check cannot run. '
      + 'This is a failure, not a skip.');
  }
}

/** Supabase password grant for the probe account: the session supabase-js stores. */
export async function passwordGrant(): Promise<Record<string, unknown>> {
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

/**
 * Put a platform session on `origin` the way supabase-js stores it
 * (localStorage['smarter-poker-auth'], flat v2 shape). `landing` is any page
 * on that origin that needs no session; /api/health answers on both origins.
 */
export async function seedPlatformSession(page: Page, origin: string, session: Record<string, unknown>) {
  await page.goto(`${origin}/api/health`);
  await page.evaluate((s) => {
    localStorage.setItem('smarter-poker-auth', JSON.stringify(s));
    sessionStorage.removeItem('commander_explicit_logout');
  }, session);
}
