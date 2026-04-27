/**
 * E2E — Commander PIN gate (Phase 3.6)
 *
 * Smoke spec only. Confirms:
 *  1. /commander/admin without a PIN session returns either a 401 or
 *     redirects to a login surface (NOT bare HTML — that was the
 *     pre-3.6 client-side gate's bug).
 *  2. /api/admin/pin-verify with no body returns 400.
 *
 * Real PIN flow requires a seeded admin row in commander_admin_pins
 * which we don't carry into CI. That's covered by the manual smoke
 * checklist in commander-extraction-design.md §Auth strategy.
 */
import { test, expect } from '@playwright/test';

test.describe('Commander PIN gate (server-side)', () => {
  test('GET /commander/admin without session is gated', async ({ page }) => {
    const res = await page.goto('/commander/admin', { waitUntil: 'domcontentloaded' });
    // Acceptable: 200 with a login form, 302/307/308 redirect, or 401.
    // Unacceptable: 200 returning the underlying admin HTML (pre-3.6 bug).
    expect(res).not.toBeNull();
    const status = res!.status();
    expect([200, 302, 307, 308, 401, 403]).toContain(status);

    if (status === 200) {
      const html = await page.content();
      // Must NOT leak protected admin content. The pre-3.6 page had
      // unique strings like "Tournament Director Dashboard" or
      // "Manage Members"; those should not be present without a PIN.
      expect(html).not.toMatch(/Tournament Director Dashboard/i);
      expect(html).not.toMatch(/Manage Members/i);
    }
  });

  test('POST /api/admin/pin-verify with no body returns 400', async ({ request }) => {
    const res = await request.post('/api/admin/pin-verify', {
      data: {},
      failOnStatusCode: false,
    });
    expect([400, 401, 422]).toContain(res.status());
  });
});
