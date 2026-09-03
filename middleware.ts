/**
 * Commander middleware.
 *
 * Enforces exactly ONE thing: the admin PIN session on /commander/admin/* and
 * /api/(commander/)?admin/* paths.
 *
 * [2026-09-03] The Supabase "pre-check" that used to live here is gone, and
 * this comment is the reason it must not come back:
 *
 *   Commander's browser client is localStorage-based (storageKey
 *   'smarter-poker-auth', see src/lib/supabase.js). It never sets Supabase
 *   cookies, so the @supabase/ssr cookie client this middleware built had
 *   nothing to read on any request - `getSession()` was always null and the
 *   code fell through to an unconditional GoTrue `auth.getUser()` round trip
 *   for a session that did not exist. The result was discarded. That call ran
 *   on every page, asset and API request in the matcher, contributed to the
 *   2026-09-01 GoTrue rate-limit saturation, and authenticated nobody.
 *
 *   Real authentication happens in exactly one place: src/lib/commander/auth.js
 *   (Bearer JWT via getUser/guardUser, HMAC-signed staff session via
 *   guardStaff/guardManager). Every API route imports that module. Adding a
 *   second opinion here - cookies, a different client, a different secret -
 *   is how 401s that nobody can explain get shipped.
 *
 * If a genuine cookie session is ever introduced (see
 * docs/runbooks/cross-subdomain-session.md), it belongs in that auth module
 * first, and this file should only ever consult it - never re-implement it.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyPinSession, readSessionCookieFromHeader } from './src/lib/auth/pinSession.js';

const ADMIN_PATH_REGEX = /^\/commander\/admin(\/.*)?$/;
// 2026-07-25 audit fix: middleware runs BEFORE next.config rewrites, so the
// same handlers are reachable at /api/commander/admin/* - the old regex only
// matched /api/admin/* and the PIN gate was fully bypassable via the prefixed
// path (which the admin UI itself uses).
const ADMIN_API_REGEX = /^\/api\/(commander\/)?admin\/.+/;
const PIN_PUBLIC_PATHS = new Set([
  '/api/admin/pin-verify',
  '/api/admin/pin-setup',
  '/api/admin/pin-logout',
  '/api/commander/admin/pin-verify',
  '/api/commander/admin/pin-setup',
  '/api/commander/admin/pin-logout',
  '/commander/admin/pin-entry',
]);

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const isAdminPath = ADMIN_PATH_REGEX.test(path) || ADMIN_API_REGEX.test(path);
  if (!isAdminPath || PIN_PUBLIC_PATHS.has(path)) return NextResponse.next();

  const cookieHeader = req.headers.get('cookie');
  const sessionValue = readSessionCookieFromHeader(cookieHeader);
  const session = await verifyPinSession(sessionValue);

  if (!session) {
    // Redirect HTML routes to PIN entry; return 401 for API routes
    if (path.startsWith('/api/')) {
      return new NextResponse(JSON.stringify({ error: 'Admin PIN required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/commander/admin/pin-entry';
    redirectUrl.searchParams.set('next', path);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

// Only the paths this middleware actually gates. The old catch-all matcher
// ran the (now deleted) Supabase pre-check on every request in the app.
export const config = {
  matcher: ['/commander/admin/:path*', '/api/admin/:path*', '/api/commander/admin/:path*'],
};
