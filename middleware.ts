/**
 * Commander middleware — minimal Supabase session validator.
 *
 * Run pattern (per design doc):
 *   - User → smarter.poker/commander/* → Vercel rewrite → commander.smarter.poker
 *   - This middleware runs on commander.smarter.poker
 *   - Validates the .smarter.poker-domain Supabase cookie
 *   - Role checks delegated to per-route handlers (lib/commander/auth.ts)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Public health endpoint — no auth
  if (req.nextUrl.pathname === '/api/health') return res;

  // Supabase cookie validation — fail-open if cookie missing (per-route handlers
  // enforce 401 if needed). Middleware here just makes the user available to SSR.
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
    console.warn('[commander-middleware] auth check failed:', err);
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
