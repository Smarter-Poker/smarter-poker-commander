/**
 * Commander middleware — Phase 3.6.
 *
 * Enforces:
 *   1. Supabase session cookie validation (all paths)
 *   2. PIN session cookie validation on /commander/admin/* paths
 *
 * Run pattern (per design doc):
 *   - User → smarter.poker/commander/* → Vercel rewrite → commander.smarter.poker
 *   - This middleware runs on commander.smarter.poker
 *   - Validates the .smarter.poker-domain Supabase cookie + admin PIN
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { verifyPinSession, readSessionCookieFromHeader } from './src/lib/auth/pinSession.js';

const ADMIN_PATH_REGEX = /^\/commander\/admin(\/.*)?$/;
const ADMIN_API_REGEX = /^\/api\/admin\/.+/;
const PIN_PUBLIC_PATHS = new Set([
  '/api/admin/pin-verify',
  '/api/admin/pin-setup',
  '/api/admin/pin-logout',
  '/commander/admin/pin-entry',
]);

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;

  // Public health endpoint — bypass all checks
  if (path === '/api/health') return res;

  // Supabase cookie pre-check — populates res.cookies for downstream handlers
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      {
        cookies: {
          get: (name) => req.cookies.get(name)?.value,
          set: (name, value, options) => res.cookies.set({ name, value, ...options }),
          remove: (name, options) => res.cookies.set({ name, value: '', ...options }),
        },
      },
    );
    await supabase.auth.getUser();
  } catch (err) {
    console.warn('[commander-middleware] supabase pre-check failed:', err);
  }

  // Admin path PIN gate
  const isAdminPath = ADMIN_PATH_REGEX.test(path) || ADMIN_API_REGEX.test(path);
  if (isAdminPath && !PIN_PUBLIC_PATHS.has(path)) {
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
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
