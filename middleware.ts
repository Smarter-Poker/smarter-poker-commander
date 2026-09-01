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
 *
 * [2026-08-19] Added resolveAnonKey() guard — fixes "Legacy API keys are
 * disabled" in the middleware Supabase pre-check (same fix applied to supabase.js).
 *
 * [2026-09-01] The Supabase pre-check no longer calls GoTrue unconditionally.
 * See the comment block on the pre-check below — this matcher covers nearly
 * every request, so an unconditional `auth.getUser()` here was one round trip
 * to GoTrue per page load, per asset, per API call.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { verifyPinSession, readSessionCookieFromHeader } from './src/lib/auth/pinSession.js';
import { resolveAnonKey } from './src/lib/supabaseKeys.js';
// Imported by relative path rather than through the `@smarter-poker/commander-shared`
// alias so the Edge bundle resolves it without depending on package `exports`
// mapping. serverAuth.js is Edge-safe: it uses only Web Crypto (crypto.subtle),
// fetch, atob, TextEncoder/TextDecoder and process.env — no Node built-ins and
// no imports of its own.
import { verifySupabaseJwt } from './vendor/commander-shared/src/lib/serverAuth.js';

// Resolve the anon key once at module load — swaps legacy JWT for publishable key
const _resolvedAnon = resolveAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const SUPABASE_ANON_KEY_RESOLVED = _resolvedAnon.key;

/**
 * Minimum remaining lifetime, in seconds, before the local fast path is
 * allowed to skip the GoTrue call. A token inside this window takes the
 * original network path, so behaviour near expiry (and under clock skew)
 * is identical to what it was before this change.
 */
const LOCAL_VERIFY_MIN_TTL_SEC = 60;

const ADMIN_PATH_REGEX = /^\/commander\/admin(\/.*)?$/;
// 2026-07-25 audit fix: middleware runs BEFORE next.config rewrites, so the
// same handlers are reachable at /api/commander/admin/* — the old regex only
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
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;

  // Public health endpoint — bypass all checks
  if (path === '/api/health') return res;

  // Supabase cookie pre-check — populates res.cookies for downstream handlers
  try {
    // @supabase/ssr ≥0.5 dropped the {get,set,remove} shape in favor of
    // {getAll,setAll}. Map req/res cookies into that new shape so the
    // session-refresh roundtrip survives the rewrite hop.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://kuklfnapbkmacvwxktbh.supabase.co',
      SUPABASE_ANON_KEY_RESOLVED,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) => {
              res.cookies.set({ name, value, ...options });
            });
          },
        },
      },
    );

    // ─────────────────────────────────────────────────────────────────────
    // LOCAL VERIFICATION FIRST — GoTrue ONLY AS A FALLBACK.
    //
    // This used to be an unconditional `await supabase.auth.getUser()`, which
    // is a network round trip to GoTrue's /auth/v1/user. On this matcher —
    // /((?!_next/static|_next/image|favicon.ico).*) — that fires on nearly
    // every inbound request, page loads and API calls alike. It was one of the
    // largest remaining sources of the GoTrue volume that saturated the
    // project-wide rate limit on 2026-09-01 and cascaded into a site-wide auth
    // redirect loop.
    //
    // It also never went through the patched createClient in
    // vendor/commander-shared/src/lib/supabaseServerClient.js: `createServerClient`
    // from @supabase/ssr is a DIFFERENT client, so none of the local-first
    // work in PR #77 reached this file.
    //
    // WHAT THE RESULT WAS USED FOR: nothing. The returned user object was
    // discarded. The call's only purpose here is the side effect — driving
    // createServerClient's cookie plumbing so a refreshed session cookie is
    // written onto `res` for downstream handlers. That is preserved:
    //
    //   - getSession() reads the session from the request cookies and, when
    //     the access token has expired, performs the refresh and writes the
    //     new cookies through setAll — exactly the same refresh side effect
    //     getUser() triggered internally. It does not call /auth/v1/user.
    //   - Only when the token verifies locally AND has more than
    //     LOCAL_VERIFY_MIN_TTL_SEC of life left do we skip the network call.
    //     A fresh token needs no refresh, so there is nothing to preserve.
    //
    // FAIL OPEN: any other outcome — no session, no token, verification
    // returns null for any reason at all (JWKS unreachable on a cold start,
    // key rotation window, tampered or expired token, thrown exception) —
    // falls through to exactly the original unconditional getUser() call
    // below. This block can only ever remove a redundant network call; it can
    // never turn a request that used to reach GoTrue into one that does not
    // get checked.
    // ─────────────────────────────────────────────────────────────────────
    let locallyVerified = false;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (accessToken) {
        const payload = await verifySupabaseJwt(accessToken);
        const nowSec = Math.floor(Date.now() / 1000);
        if (
          payload &&
          typeof payload.exp === 'number' &&
          payload.exp - nowSec > LOCAL_VERIFY_MIN_TTL_SEC
        ) {
          locallyVerified = true;
        }
      }
    } catch (err) {
      // Deliberately swallowed: the network path below is the fallback.
      console.warn('[commander-middleware] local JWT verification unavailable:', err);
    }

    if (!locallyVerified) {
      await supabase.auth.getUser();
    }
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
