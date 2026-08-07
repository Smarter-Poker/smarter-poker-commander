/**
 * Commander auth — local implementation (2026-07-25 security audit).
 *
 * History:
 *  - 2026-05-12: getUser/guardUser overridden locally to accept Bearer tokens
 *    (smarter.poker -> commander.smarter.poker rewrites carry localStorage
 *    sessions as Authorization headers, not cookies).
 *  - 2026-07-25: the remaining guards are now ALSO implemented locally, fixing
 *    two P0s found in the Club Commander audit:
 *      1. verifyStaffSession trusted the raw client-supplied x-staff-session
 *         JSON with no signature — any caller could forge a staff/owner
 *         identity. Sessions are now HMAC-signed server-side (SUPABASE_JWT_SECRET,
 *         same secret pinSession.js uses) and verified on every request.
 *      2. Staff lookups matched only linked_user_id while registration wrote
 *         user_id, locking newly registered owners/staff out. All lookups now
 *         match either column.
 *
 * Signed session shape (issued by /api/staff/verify-pin and
 * /api/check-subscription, stored client-side as `commander_staff`):
 *   { id?, user_id?, venue_id, role, session_ts, sig }
 * sig = HMAC-SHA256(`${id}|${user_id}|${venue_id}|${role}|${session_ts}`).
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Constants + pure helpers still come from the shared package (no behavior).
export {
  COMP_ROLES,
  DEFAULT_PERMISSIONS,
  SENSITIVE_ROUTES,
  isSensitiveRoute,
  ROLE_ROUTE_ACCESS,
  canRoleAccessRoute,
  getEffectivePermissions,
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

// ─────────────────────────────────────────────────────────────────────────────
// PIN verification (bcrypt-hashed — local override)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a staff PIN for a venue and return the staff row (or null).
 *
 * 2026-08-07: this was re-exported from the shared package, where it compared
 * `commander_staff.pin_code` with a PLAINTEXT equality filter. PINs are now
 * bcrypt-hashed into `pin_hash` (with a BEFORE INSERT/UPDATE trigger keeping
 * future writes hashed). fn_verify_staff_pin checks the hash and falls back to
 * the legacy plaintext column for any row not yet hashed, so a staff member can
 * never be locked out mid-migration.
 */
export async function verifyPin(venueId, pinCode) {
  if (venueId === undefined || venueId === null || !pinCode) return null;

  const { data: staffId, error: rpcError } = await getAdminClient()
    .rpc('fn_verify_staff_pin', { p_venue_id: String(venueId), p_pin: String(pinCode) });

  if (rpcError) {
    console.warn('[commander-auth] fn_verify_staff_pin failed:', rpcError.message || rpcError);
    return null;
  }
  if (!staffId) return null;

  const { data: staff, error } = await getAdminClient()
    .from('commander_staff')
    .select(`
      *,
      profiles (
        id,
        display_name,
        avatar_url
      )
    `)
    .eq('id', staffId)
    .maybeSingle();

  if (error || !staff) return null;
  return staff;
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff-session signing
// ─────────────────────────────────────────────────────────────────────────────

const PIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;      // PIN terminals: 12h
const OWNER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // Owner logins: 7d

function sessionSecret() {
  const secret = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('[commander-auth] no signing secret configured');
  return secret;
}

function canonicalSessionString(s) {
  return [s.id || '', s.user_id || '', s.venue_id ?? '', s.role || '', s.session_ts ?? ''].join('|');
}

/**
 * Sign a staff-session payload server-side. Returns the payload plus `sig`.
 * Only ever call this AFTER the caller's identity has been verified
 * (PIN checked, or Supabase JWT validated against the subscription/staff row).
 */
export function signStaffSession(payload) {
  const session_ts = payload.session_ts || Date.now();
  const body = { ...payload, session_ts };
  const sig = crypto.createHmac('sha256', sessionSecret())
    .update(canonicalSessionString(body))
    .digest('hex');
  return { ...body, sig };
}

function verifySessionSignature(sessionData) {
  if (!sessionData.sig || !sessionData.session_ts) return false;
  try {
    const expected = crypto.createHmac('sha256', sessionSecret())
      .update(canonicalSessionString(sessionData))
      .digest('hex');
    const a = Buffer.from(String(sessionData.sig), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User resolution (Bearer-first, cookie fallback)
// ─────────────────────────────────────────────────────────────────────────────

export async function getUser(req, res) {
  // Path 1: Authorization: Bearer <token>
  try {
    const headerVal = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    const m = typeof headerVal === 'string' ? headerVal.match(/^Bearer\s+(.+)$/i) : null;
    const token = m ? m[1].trim() : '';
    if (token) {
      const { data, error } = await getAdminClient().auth.getUser(token);
      if (!error && data && data.user) return data.user;
      if (error) console.warn('[commander-auth] Bearer token rejected:', error.message || error);
    }
  } catch (e) {
    console.warn('[commander-auth] Bearer path failed:', e && e.message ? e.message : e);
  }

  // Path 2: cookie-based session (same-origin fallback)
  try {
    const { createPagesServerClient } = await import('@supabase/auth-helpers-nextjs');
    const sb = createPagesServerClient({ req, res });
    const { data } = await sb.auth.getUser();
    if (data && data.user) return data.user;
  } catch (e) {
    if (e && e.message && !/cookie/i.test(e.message)) {
      console.warn('[commander-auth] cookie path failed:', e.message);
    }
  }

  return null;
}

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

export async function requireAuth(req, res) {
  return guardUser(req, res);
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT-based staff checks (match user_id OR linked_user_id)
// ─────────────────────────────────────────────────────────────────────────────

function userMatchFilter(userId) {
  return `linked_user_id.eq.${userId},user_id.eq.${userId}`;
}

export async function requireStaff(req, res, venueId, allowedRoles = null) {
  const user = await requireAuth(req, res);
  if (!user) return null;

  const { data: staff, error } = await getAdminClient()
    .from('commander_staff')
    .select('*')
    .eq('venue_id', venueId)
    .or(userMatchFilter(user.id))
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error || !staff) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Staff Access Required' },
    });
    return null;
  }

  if (allowedRoles && !allowedRoles.includes(staff.role)) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: `Requires role: ${allowedRoles.join(' or ')}` },
    });
    return null;
  }

  return staff;
}

export async function requireManager(req, res, venueId) {
  return requireStaff(req, res, venueId, ['owner', 'manager']);
}

export async function requireFloor(req, res, venueId) {
  return requireStaff(req, res, venueId, ['owner', 'manager', 'dualrate', 'floor']);
}

export async function isStaffAnywhere(userId) {
  const { count, error } = await getAdminClient()
    .from('commander_staff')
    .select('id', { count: 'exact', head: true })
    .or(userMatchFilter(userId))
    .eq('is_active', true);
  return !error && count > 0;
}

export async function getStaffVenues(userId) {
  const { data, error } = await getAdminClient()
    .from('commander_staff')
    .select('*, poker_venues ( id, name, city, state )')
    .or(userMatchFilter(userId))
    .eq('is_active', true);
  if (error) {
    console.warn('getStaffVenues error:', error);
    return [];
  }
  return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff-session verification (x-staff-session header, HMAC-verified)
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyStaffSession(req) {
  const staffSession = req.headers['x-staff-session'];
  if (!staffSession) {
    return { error: { status: 401, code: 'AUTH_REQUIRED', message: 'Staff Authentication Required' } };
  }

  let sessionData;
  try {
    sessionData = JSON.parse(staffSession);
  } catch {
    return { error: { status: 401, code: 'INVALID_SESSION', message: 'Invalid Session Format' } };
  }

  // Signature gate — unsigned/forged sessions are rejected. Sessions issued
  // before the 2026-07-25 deploy lack `sig`; those users must log in again.
  if (!verifySessionSignature(sessionData)) {
    return { error: { status: 401, code: 'SESSION_EXPIRED', message: 'Session Expired — Please Sign In Again' } };
  }

  // Path 1: PIN-based staff terminal — session contains staff row `id`
  if (sessionData.id) {
    if (Date.now() - sessionData.session_ts > PIN_SESSION_TTL_MS) {
      return { error: { status: 401, code: 'SESSION_EXPIRED', message: 'PIN session expired — please re-enter your PIN' } };
    }

    const { data: staff, error: staffError } = await getAdminClient()
      .from('commander_staff')
      .select('id, venue_id, role, is_active, linked_user_id, user_id, display_name, permissions')
      .eq('id', sessionData.id)
      .eq('is_active', true)
      .maybeSingle();

    if (staffError || !staff) {
      return { error: { status: 401, code: 'INVALID_STAFF', message: 'Staff Member Not Found Or Inactive' } };
    }
    return { staff };
  }

  // Path 2: Owner login — session contains `user_id` + `venue_id`
  if (sessionData.user_id && sessionData.venue_id) {
    if (Date.now() - sessionData.session_ts > OWNER_SESSION_TTL_MS) {
      return { error: { status: 401, code: 'SESSION_EXPIRED', message: 'Session expired — please sign in again' } };
    }

    const { data: staff } = await getAdminClient()
      .from('commander_staff')
      .select('id, venue_id, role, is_active, linked_user_id, user_id, display_name, permissions')
      .or(userMatchFilter(sessionData.user_id))
      .eq('venue_id', sessionData.venue_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (staff) return { staff };

    if (sessionData.role === 'owner') {
      const { data: sub } = await getAdminClient()
        .from('commander_subscriptions')
        .select('id, venue_id, owner_id, status')
        .eq('owner_id', sessionData.user_id)
        .eq('venue_id', sessionData.venue_id)
        .in('status', ['active', 'trialing'])
        .maybeSingle();

      if (sub) {
        return {
          staff: {
            id: sessionData.user_id,
            user_id: sessionData.user_id,
            linked_user_id: sessionData.user_id,
            venue_id: sub.venue_id,
            role: 'owner',
            is_active: true,
          },
        };
      }
    }
  }

  return { error: { status: 401, code: 'INVALID_STAFF', message: 'Staff Member Not Found Or Inactive' } };
}

export async function verifyManagerSession(req, venueId = null) {
  const result = await verifyStaffSession(req);
  if (result.error) return result;

  if (venueId && String(result.staff.venue_id) !== String(venueId)) {
    return { error: { status: 403, code: 'FORBIDDEN', message: 'Not Authorized For This Venue' } };
  }
  if (!['owner', 'manager'].includes(result.staff.role)) {
    return { error: { status: 403, code: 'FORBIDDEN', message: 'Manager Role Required' } };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

export async function guardStaff(req, res) {
  const result = await verifyStaffSession(req);
  if (result.error) {
    res.status(result.error.status || 401).json({ success: false, error: result.error });
    return null;
  }
  return result.staff;
}

export async function guardManager(req, res, venueId = null) {
  const result = await verifyManagerSession(req, venueId);
  if (result.error) {
    res.status(result.error.status || 401).json({ success: false, error: result.error });
    return null;
  }
  return result.staff;
}

/**
 * Require staff auth only for write methods; GET passes through.
 * NOTE: routes serving PII or venue-scoped data on GET must add their own
 * read-side guard — a bare `guardWriteStaff` means the GET is public.
 */
export async function guardWriteStaff(req, res) {
  if (req.method === 'GET') return true;
  return guardStaff(req, res);
}

/**
 * Require BOTH a signed staff session AND a valid Supabase JWT, owner/manager
 * role only. The JWT user must match the staff row it claims to be (fixes the
 * omitted cross-check flagged in the 2026-07-25 audit).
 */
export async function guardOwnerStaff(req, res) {
  const staff = await guardStaff(req, res);
  if (!staff) return null;

  const user = await getUser(req, res);
  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: 'JWT_REQUIRED', message: 'Valid session token required for this operation' },
    });
    return null;
  }

  // Cross-check: the JWT identity must match the staff session identity.
  const staffUserIds = [staff.linked_user_id, staff.user_id, staff.id].filter(Boolean).map(String);
  if (!staffUserIds.includes(String(user.id))) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Session identity mismatch' },
    });
    return null;
  }

  if (!['owner', 'manager'].includes(staff.role)) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Owner or Manager role required' },
    });
    return null;
  }

  return { ...staff, user };
}
