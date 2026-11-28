/**
 * LIVE PROOF: THE SERVER'S BUSINESS DATE IS THE VENUE'S DATE (2026-11-28)
 *
 * PR #175 replaced the UTC "today" (`toISOString()` cut) with the venue's
 * calendar date (`businessDate.js` + `venueTimeZone.js`). The defect showed
 * only from 6 PM Central to midnight, when UTC is already tomorrow: close
 * day, shift handoff, dealer rotations and the daily report all landed on the
 * next day. Unit tests pin the module; this asks PRODUCTION.
 *
 * As the probe account it mints the signed staff session (the same silent
 * /commander/login hop the staff census uses), then reads, GET only,
 * `/api/reports/daily?venue_id=<probe venue>` with no date: the route answers
 * `report.date = businessDateKey(now, fetchVenueTimeZone(venue))`, the same
 * derivation every stamped date uses. The expected value is computed here
 * independently: the venue's zone from its public `poker_venues` row
 * (timezone, else its US state, else America/Chicago: the product rule) and
 * the date in that zone from Intl, read just before and just after the
 * request so a run straddling midnight still has one right answer.
 *
 * Meaningful at every run time: it always asserts server == venue-local
 * date, and whenever the venue date differs from the UTC date (6 PM Central
 * to midnight for a Central venue, i.e. the window the defect lived in, hit
 * by the 30-minute schedule every evening) it additionally asserts the
 * server did NOT answer the UTC date, and records that the evening window
 * was exercised. No retries.
 */
import { test, expect } from '@playwright/test';
import { venueTimeZone } from '../../vendor/commander-shared/src/lib/commander/businessDate.js';
import { assertProbeSecrets, HAVE_PROBE_SECRETS, passwordGrant, seedPlatformSession, SUPABASE_ANON, SUPABASE_URL } from './probeSession';

assertProbeSecrets('business-date.spec.ts');

/** YYYY-MM-DD of `at` in `timeZone`, straight from Intl. */
function intlDateKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

test.describe('venue business date in production', () => {
  test.skip(!HAVE_PROBE_SECRETS,
    'PROBE_EMAIL / PROBE_PASSWORD secrets are not set on this repository: the business-date check did not run');
  test.skip(({ browserName }) => browserName !== 'chromium', 'a server answer, one browser is enough');
  test.describe.configure({ retries: 0, timeout: 120_000 });

  test('the daily report defaults to the venue-local date, also after 6 PM Central', async ({ page, baseURL }, info) => {
    await seedPlatformSession(page, new URL(baseURL!).origin, await passwordGrant());
    await page.evaluate(() => localStorage.removeItem('commander_staff'));
    await page.goto('/commander/login');
    await page.waitForURL(/\/commander\/dashboard/, { timeout: 45_000 });
    const staff = await page.evaluate(() => JSON.parse(localStorage.getItem('commander_staff') || 'null'));
    expect(staff?.sig, 'staff session must be server-signed').toBeTruthy();
    const venueId = staff?.venue_id;
    expect(venueId, 'probe staff session names a venue').toBeTruthy();

    // The venue's zone from its public row (poker_venues is public-read).
    const venueRes = await fetch(`${SUPABASE_URL}/rest/v1/poker_venues?id=eq.${encodeURIComponent(venueId)}&select=id,timezone,state`, {
      headers: { apikey: SUPABASE_ANON, Accept: 'application/json' },
    });
    expect(venueRes.ok, `poker_venues read: ${venueRes.status}`).toBeTruthy();
    const [venue] = await venueRes.json();
    expect(venue, `venue ${venueId} row`).toBeTruthy();
    const zone = venueTimeZone(venue);

    const before = new Date();
    const answer = await page.evaluate(async (v) => {
      const auth = JSON.parse(localStorage.getItem('smarter-poker-auth') || '{}');
      const headers: Record<string, string> = { 'x-staff-session': localStorage.getItem('commander_staff') || '' };
      if (auth.access_token) headers.Authorization = `Bearer ${auth.access_token}`;
      const r = await fetch(`/api/reports/daily?venue_id=${encodeURIComponent(v)}`, { headers });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, String(venueId));
    const after = new Date();

    expect(answer.status, `GET /api/reports/daily: ${JSON.stringify(answer.body)?.slice(0, 300)}`).toBe(200);
    const serverDate = answer.body?.data?.report?.date;
    expect(serverDate, 'report.date').toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const expected = [...new Set([intlDateKey(before, zone), intlDateKey(after, zone)])];
    const utc = [...new Set([intlDateKey(before, 'UTC'), intlDateKey(after, 'UTC')])];
    const central = intlDateKey(before, 'America/Chicago');
    const centralHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hourCycle: 'h23' }).format(before));
    const evening = expected.length === 1 && utc.length === 1 && expected[0] !== utc[0];
    const note = `venue ${venueId} zone ${zone}; server ${serverDate}; venue-local ${expected.join('|')}; UTC ${utc.join('|')}; `
      + `Central ${central} ${centralHour}:00 hour; ${evening ? 'venue date differs from UTC date (the evening window): exercised' : 'venue date equals UTC date now'}`;
    info.annotations.push({ type: 'business-date', description: note });
    console.log(`[business-date] ${note}`);

    expect(expected, `server business date ${serverDate} must equal the venue-local date in ${zone}`).toContain(serverDate);
    if (evening) expect(serverDate, 'server answered the UTC date, not the venue date').not.toBe(utc[0]);
  });
});
