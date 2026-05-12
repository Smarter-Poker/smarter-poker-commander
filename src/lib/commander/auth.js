/**
 * Dan-fix/auth-bearer (2026-05-12): override getUser/guardUser to also
 * accept a Bearer token from the Authorization header.
 *
 * Root cause of "submit fails silently" on /hub/commander/home-games/create:
 * World Hub stores Supabase auth in localStorage (key 'smarter-poker-auth')
 * and sends API calls with `Authorization: Bearer <token>`. When the request
 * is rewritten from smarter.poker → commander.smarter.poker, the upstream
 * commander-shared getUser() relied entirely on cookie-based auth via
 * createPagesServerClient. No supabase cookie → TypeError → 401.
 *
 * Logs from commander prod confirmed:
 *   13:55:21 POST /api/home-games/groups 401  "Auth getUser error: TypeErr..."
 *
 * Fix: try Bearer header first (validates via service-role client), fall
 * back to cookie path for any same-origin caller that still uses it.
 * Re-export every other auth helper unchanged.
 */
import { createClient } from '@supabase/supabase-js';

// Re-export everything from commander-shared EXCEPT getUser + guardUser
// (those are overridden below). Listing explicitly so the override wins.
export {
  requireAuth,
  requireStaff,
  requireManager,
  requireFloor,
  isStaffAnywhere,
  getStaffVenues,
  verifyPin,
  verifyStaffSession,
  verifyManagerSession,
  COMP_ROLES,
  DEFAULT_PERMISSIONS,
  SENSITIVE_ROUTES,
  isSensitiveRoute,
  ROLE_ROUTE_ACCESS,
  canRoleAccessRoute,
  getEffectivePermissions,
  guardStaff,
  guardManager,
  guardWriteStaff,
  guardOwnerStaff,
} from '@smarter-poker/commander-shared/lib/commander/auth';

let _admin;
function getAdminClient() {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
             || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _admin;
}

/**
 * Resolve the authenticated user from a Next.js Pages-API request.
 *
 * Path 1 (cross-subdomain client): Authorization: Bearer <jwt>
 *   - Used by smarter.poker → commander.smarter.poker rewrites where the
 *     calling app keeps the session in localStorage and forwards it as a
 *     Bearer header.
 *
 * Path 2 (same-origin client): Supabase auth cookie
 *   - Preserved for any caller that still relies on the cookie session.
 *
 * Returns the user object, or null if neither path resolves.
 */
export async function getUser(req, res) {
  // ── Path 1: Authorization: Bearer <token> ───────────────────────────
  try {
    const headerVal = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    const m = typeof headerVal === 'string' ? headerVal.match(/^Bearer\s+(.+)$/i) : null;
    const token = m ? m[1].trim() : '';
    if (token) {
      const { data, error } = await getAdminClient().auth.getUser(token);
      if (!error && data && data.user) {
        return data.user;
      }
      if (error) {
        console.warn('[commander-auth] Bearer token rejected:', error.message || error);
      }
    }
  } catch (e) {
    console.warn('[commander-auth] Bearer path failed:', e && e.message ? e.message : e);
  }

  // ── Path 2: cookie-based session (same-origin fallback) ─────────────
  try {
    const { createPagesServerClient } = await import('@supabase/auth-helpers-nextjs');
    const sb = createPagesServerClient({ req, res });
    const { data } = await sb.auth.getUser();
    if (data && data.user) return data.user;
  } catch (e) {
    // Suppress the noisy TypeError createPagesServerClient throws when no
    // cookie is present at all — that's expected for Bearer-only clients.
    if (e && e.message && !/cookie/i.test(e.message)) {
      console.warn('[commander-auth] cookie path failed:', e.message);
    }
  }

  return null;
}

/**
 * Guard: require Supabase user auth or send 401. Returns user or null.
 * Matches the upstream shape: { success: false, error: { code, message } }.
 */
export async function guardUser(req, res) {
  const user = await getUser(req, res);
  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Authentication Required' },
    });
    return null;
  }
  return user;
}
