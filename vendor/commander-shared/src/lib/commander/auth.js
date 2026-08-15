/**
 * Commander Authentication Middleware
 * Reference: IMPLEMENTATION_PHASES.md - Step 1.3
 */
import { createClient } from '@supabase/supabase-js';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';
import crypto from 'crypto';

// Lazy getter — prevents SSR crashes if client components import constants from this file.
// Server-only env vars like SUPABASE_SERVICE_ROLE_KEY are undefined in the browser.
let _supabase;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
    );
  }
  return _supabase;
}

// ── Staff-session signature verification ─────────────────────────────────────
// This module used to trust the raw client-supplied `x-staff-session` JSON with
// NO signature check, so any caller could forge a staff (or owner) identity just
// by sending a staff row id. The Commander app shipped a hardened local copy,
// but this shared copy stayed forgeable — a landmine for any consumer that
// imports it. Sessions are HMAC-signed when issued, so verifying here rejects
// forgeries without rejecting a single legitimate session.

function sessionSecret() {
  const secret = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('[commander-auth] no signing secret configured');
  return secret;
}

function canonicalSessionString(s) {
  return [s.id || '', s.user_id || '', s.venue_id ?? '', s.role || '', s.session_ts ?? ''].join('|');
}

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

/**
 * Get the authenticated user from request
 * @param {object} req - Next.js request object
 * @param {object} res - Next.js response object
 * @returns {object|null} - User object or null
 */
export async function getUser(req, res) {
  try {
    const supabaseServerClient = createPagesServerClient({ req, res });
    const { data: authData } = await supabaseServerClient.auth.getUser();
    const user = authData?.user;
    return user;
  } catch (error) {
    console.warn('Auth getUser error:', error);
    return null;
  }
}

/**
 * Require authentication - returns 401 if not authenticated
 * @param {object} req - Next.js request object
 * @param {object} res - Next.js response object
 * @returns {object|null} - User object or null (response already sent)
 */
export async function requireAuth(req, res) {
  const user = await getUser(req, res);

  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Authentication Required' }
    });
    return null;
  }

  return user;
}

/**
 * Require staff role at a venue
 * @param {object} req - Next.js request object
 * @param {object} res - Next.js response object
 * @param {string} venueId - Venue ID to check staff membership
 * @param {string[]} allowedRoles - Optional array of allowed roles (default: all staff)
 * @returns {object|null} - Staff object or null (response already sent)
 */
export async function requireStaff(req, res, venueId, allowedRoles = null) {
  const user = await requireAuth(req, res);
  if (!user) return null;

  const { data: staff, error } = await getSupabase()
    .from('commander_staff')
    .select('*')
    .eq('venue_id', venueId)
    .eq('linked_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !staff) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Staff Access Required' }
    });
    return null;
  }

  // Check role if specific roles required
  if (allowedRoles && !allowedRoles.includes(staff.role)) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: `Requires role: ${allowedRoles.join(' or ')}`
      }
    });
    return null;
  }

  return staff;
}

/**
 * Require manager role at a venue (owner or manager)
 * @param {object} req - Next.js request object
 * @param {object} res - Next.js response object
 * @param {string} venueId - Venue ID to check
 * @returns {object|null} - Staff object or null
 */
export async function requireManager(req, res, venueId) {
  return requireStaff(req, res, venueId, ['owner', 'manager']);
}

/**
 * Require floor staff or higher (owner, manager, dualrate, or floor)
 * @param {object} req - Next.js request object
 * @param {object} res - Next.js response object
 * @param {string} venueId - Venue ID to check
 * @returns {object|null} - Staff object or null
 */
export async function requireFloor(req, res, venueId) {
  return requireStaff(req, res, venueId, ['owner', 'manager', 'dualrate', 'floor']);
}

/**
 * Check if user is staff at any venue (for quick checks)
 * @param {string} userId - User ID to check
 * @returns {boolean} - True if user is staff somewhere
 */
export async function isStaffAnywhere(userId) {
  const { count, error } = await getSupabase()
    .from('commander_staff')
    .select('id', { count: 'exact', head: true })
    .eq('linked_user_id', userId)
    .eq('is_active', true);

  return !error && count > 0;
}

/**
 * Get all venues where user is staff
 * @param {string} userId - User ID to check
 * @returns {object[]} - Array of venue staff records
 */
export async function getStaffVenues(userId) {
  const { data, error } = await getSupabase()
    .from('commander_staff')
    .select(`
      *,
      poker_venues (
        id,
        name,
        city,
        state
      )
    `)
    .eq('linked_user_id', userId)
    .eq('is_active', true);

  if (error) {
    console.warn('getStaffVenues error:', error);
    return [];
  }

  return data || [];
}

/**
 * Verify PIN and return staff info
 * @param {string} venueId - Venue ID
 * @param {string} pinCode - PIN code to verify
 * @returns {object|null} - Staff object or null
 */
export async function verifyPin(venueId, pinCode) {
  // 2026-08-14: PINs are bcrypt-hashed (commander_staff.pin_hash; a BEFORE
  // trigger hashes and NULLs any plaintext write). This function previously
  // compared the plaintext pin_code column directly — dead wrong post-hashing
  // (the column is always NULL) and the last plaintext PIN comparison left in
  // code. fn_verify_staff_pin checks the hash server-side and returns the
  // staff id, or NULL for a bad PIN.
  if (venueId === undefined || venueId === null || !pinCode) return null;

  const { data: staffId, error: rpcError } = await getSupabase()
    .rpc('fn_verify_staff_pin', { p_venue_id: String(venueId), p_pin: String(pinCode) });

  if (rpcError || !staffId) {
    return null;
  }

  const { data: staff, error } = await getSupabase()
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

  if (error || !staff) {
    return null;
  }

  return staff;
}

/**
 * Verify staff via x-staff-session header
 * Supports TWO auth flows:
 *   1. PIN-based terminal auth: session has `id` (commander_staff row ID)
 *   2. Owner email/password login: session has `user_id` + `role: 'owner'`
 *
 * @param {object} req - Next.js request object
 * @returns {object} - { staff } on success, { error: { status, code, message } } on failure
 */
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

  // Signature gate — fail CLOSED. An unsigned or tampered session is a forgery
  // attempt, not a legacy client: every issuer signs sessions at creation.
  if (!verifySessionSignature(sessionData)) {
    return { error: { status: 401, code: 'SESSION_EXPIRED', message: 'Session Expired — Please Sign In Again' } };
  }

  // Path 1: PIN-based staff terminal — session contains staff row `id`
  if (sessionData.id) {
    // TTL check: reject PIN sessions older than 12 hours (if timestamp present)
    const PIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
    if (sessionData.session_ts && (Date.now() - sessionData.session_ts > PIN_SESSION_TTL_MS)) {
      return { error: { status: 401, code: 'SESSION_EXPIRED', message: 'PIN session expired — please re-enter your PIN' } };
    }

    const { data: staff, error: staffError } = await getSupabase()
      .from('commander_staff')
      .select('id, venue_id, role, is_active')
      .eq('id', sessionData.id)
      .eq('is_active', true)
      .maybeSingle();

    if (staffError || !staff) {
      return { error: { status: 401, code: 'INVALID_STAFF', message: 'Staff Member Not Found Or Inactive' } };
    }

    return { staff };
  }

  // Path 2: Owner login — session contains `user_id` + `role` + `venue_id`
  if (sessionData.user_id && sessionData.venue_id) {
    // First try: look up commander_staff row by linked_user_id
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, venue_id, role, is_active')
      .eq('linked_user_id', sessionData.user_id)
      .eq('venue_id', sessionData.venue_id)
      .eq('is_active', true)
      .maybeSingle();

    if (staff) {
      return { staff };
    }

    // Fallback for owners: verify via subscription (owners may not have commander_staff rows)
    if (sessionData.role === 'owner') {
      const { data: sub } = await getSupabase()
        .from('commander_subscriptions')
        .select('id, venue_id, owner_id, status')
        .eq('owner_id', sessionData.user_id)
        .eq('venue_id', sessionData.venue_id)
        .in('status', ['active', 'trialing'])
        .maybeSingle();

      if (sub) {
        // Return a synthetic staff object for the owner
        return {
          staff: {
            id: sessionData.user_id,
            venue_id: sub.venue_id,
            role: 'owner',
            is_active: true,
          }
        };
      }
    }
  }

  return { error: { status: 401, code: 'INVALID_STAFF', message: 'Staff Member Not Found Or Inactive' } };
}

/**
 * Verify staff session and require manager role (owner or manager)
 * @param {object} req - Next.js request object
 * @param {number|string} venueId - Optional venue ID to check membership
 * @returns {object} - { staff } on success, { error } on failure
 */
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

// ── Roles that can issue comps ──
export const COMP_ROLES = ['owner', 'manager', 'dualrate'];

// Default permissions by role
export const DEFAULT_PERMISSIONS = {
  owner: {
    manage_staff: true,
    manage_games: true,
    manage_waitlist: true,
    manage_settings: true,
    view_analytics: true,
    send_notifications: true,
    issue_comps: true,
    view_reports: true,
    manage_billing: true,
  },
  manager: {
    manage_staff: true,
    manage_games: true,
    manage_waitlist: true,
    manage_settings: true,
    view_analytics: true,
    send_notifications: true,
    issue_comps: true,
    view_reports: true,
    manage_billing: false,
  },
  dualrate: {
    manage_staff: false,
    manage_games: true,
    manage_waitlist: true,
    manage_settings: false,
    view_analytics: false,
    send_notifications: true,
    issue_comps: true,
    view_reports: false,
    manage_billing: false,
  },
  floor: {
    manage_staff: false,
    manage_games: true,
    manage_waitlist: true,
    manage_settings: false,
    view_analytics: false,
    send_notifications: true,
    issue_comps: false,
    view_reports: false,
    manage_billing: false,
  },
  brush: {
    manage_staff: false,
    manage_games: false,
    manage_waitlist: true,
    manage_settings: false,
    view_analytics: false,
    send_notifications: false,
    issue_comps: false,
    view_reports: false,
    manage_billing: false,
  },
  dealer: {
    manage_staff: false,
    manage_games: false,
    manage_waitlist: false,
    manage_settings: false,
    view_analytics: false,
    send_notifications: false,
    issue_comps: false,
    view_reports: false,
    manage_billing: false,
  },
  cashier: {
    manage_staff: false,
    manage_games: false,
    manage_waitlist: false,
    manage_settings: false,
    view_analytics: false,
    send_notifications: false,
    issue_comps: false,
    view_reports: false,
    manage_billing: false,
  },
  security: {
    manage_staff: false,
    manage_games: false,
    manage_waitlist: false,
    manage_settings: false,
    view_analytics: false,
    send_notifications: false,
    issue_comps: false,
    view_reports: false,
    manage_billing: false,
  }
};

// ── Sensitive Routes — ALWAYS require PIN challenge, even for owners/managers ──
// These are OWNER/MANAGER-ONLY pages that expose confidential data (employee PINs,
// venue config, business intelligence). They require a per-session PIN verification
// regardless of cached staff session. Pages that floor, cashier, or dualrate staff
// need access to are NOT included here — those rely on the standard role gate.
export const SENSITIVE_ROUTES = [
  '/commander/staff',              // Employee PINs and management
  '/commander/settings',           // Venue configuration
  '/commander/analytics',          // Business analytics
  '/commander/reports',            // Financial reports
  '/commander/close-day',          // End-of-day financial close
  '/commander/exports',            // Data exports
  '/commander/churn-prediction',   // Business intelligence
];

/**
 * Check if a route is sensitive (requires mandatory PIN even for authenticated staff)
 * @param {string} href - Route path
 * @returns {boolean}
 */
export function isSensitiveRoute(href) {
  const clean = href.split('?')[0]; // strip query params
  return SENSITIVE_ROUTES.some(r => clean === r || clean.startsWith(r + '/'));
}

// ── Role-Based Route Access Map ──
// Each role maps to an array of allowed route prefixes.
// Owner and manager get '*' (all routes).
export const ROLE_ROUTE_ACCESS = {
  owner: ['*'],
  manager: ['*'],
  dualrate: [
    '/commander/dashboard',
    '/commander/waitlist', '/commander/members', '/commander/kiosk', '/commander/member-import',
    '/commander/membership-plans',
    '/commander/displays',
    '/commander/tournaments', '/commander/tournament-settings', '/commander/tournament-clocks',
    '/commander/tournament-maintenance', '/commander/clock-setup', '/commander/leagues',
    '/commander/tournament-controls',
    '/commander/tables', '/commander/table-assignments', '/commander/floor',
    '/commander/open-game', '/commander/must-move', '/commander/floor-calls',
    '/commander/dealer-rotation', '/commander/table-tablets',
    '/commander/cashier', '/commander/time-clock', '/commander/time-billing',
    '/commander/shift-handoff', '/commander/poker-room', '/commander/room-presets',
    '/commander/comps', '/commander/notifications', '/commander/promotions',
    '/commander/high-hands', '/commander/streaming',
    '/commander/leaderboard-builder',
    '/commander/incidents',
  ],
  floor: [
    '/commander/dashboard',
    '/commander/waitlist', '/commander/members', '/commander/kiosk',
    '/commander/displays',
    '/commander/tournaments', '/commander/tournament-settings', '/commander/tournament-clocks',
    '/commander/tournament-maintenance', '/commander/clock-setup', '/commander/leagues',
    '/commander/tournament-controls',
    '/commander/tables', '/commander/table-assignments', '/commander/floor',
    '/commander/open-game', '/commander/must-move', '/commander/floor-calls',
    '/commander/dealer-rotation', '/commander/table-tablets',
    '/commander/time-clock', '/commander/shift-handoff', '/commander/incidents',
    '/commander/poker-room', '/commander/room-presets',
    '/commander/notifications', '/commander/promotions',
    '/commander/high-hands', '/commander/streaming',
    '/commander/leaderboard-builder',
  ],
  brush: [
    '/commander/dashboard',
    '/commander/waitlist', '/commander/kiosk',
    '/commander/displays',
    '/commander/table-tablets',
    '/commander/time-clock',
  ],
  cashier: [
    '/commander/dashboard',
    '/commander/cashier', '/commander/time-clock', '/commander/time-billing',
    '/commander/members',
  ],
  dealer: [
    '/commander/dashboard',
    '/commander/table-tablets',
    '/commander/time-clock',
  ],
  security: [
    '/commander/dashboard',
    '/commander/incidents', '/commander/floor-calls',
    '/commander/time-clock',
  ],
};

/**
 * Check if a role can access a given route
 * @param {string} role - Staff role
 * @param {string} href - Route path
 * @returns {boolean}
 */
export function canRoleAccessRoute(role, href) {
  const routes = ROLE_ROUTE_ACCESS[role];
  if (!routes) return false;
  if (routes.includes('*')) return true;
  return routes.some(r => href === r || href.startsWith(r + '/'));
}

/**
 * Get effective permissions for a staff member
 * @param {object} staff - Staff record
 * @returns {object} - Merged permissions
 */
export function getEffectivePermissions(staff) {
  return {
    ...DEFAULT_PERMISSIONS[staff.role] || {},
    ...(staff.permissions || {})
  };
}

/**
 * Guard: require staff auth or send 401. Returns staff or null.
 * Usage: const staff = await guardStaff(req, res); if (!staff) return;
 */
export async function guardStaff(req, res) {
  const result = await verifyStaffSession(req);
  if (result.error) {
    res.status(result.error.status || 401).json({ success: false, error: result.error });
    return null;
  }
  return result.staff;
}

/**
 * Guard: require manager auth or send 401/403. Returns staff or null.
 */
export async function guardManager(req, res) {
  const result = await verifyManagerSession(req);
  if (result.error) {
    res.status(result.error.status || 401).json({ success: false, error: result.error });
    return null;
  }
  return result.staff;
}

/**
 * Guard: require Supabase user auth or send 401. Returns user or null.
 * For player-facing endpoints (not staff).
 */
export async function guardUser(req, res) {
  const user = await getUser(req, res);
  if (!user) {
    res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication Required' } });
    return null;
  }
  return user;
}

/**
 * Guard: require staff auth only for write methods (POST/PUT/PATCH/DELETE).
 * GET requests pass through. Returns staff for writes, true for reads.
 */
export async function guardWriteStaff(req, res) {
  if (req.method === 'GET') return true;
  return guardStaff(req, res);
}

/**
 * Guard: require BOTH staff session + valid Supabase JWT (owner/manager only).
 * For routes where only owners/managers with a real Supabase session should access.
 * PIN-based terminal staff (no JWT) will be rejected since these routes are owner-only.
 * Returns staff object or null (response already sent).
 */
export async function guardOwnerStaff(req, res) {
  // Step 1: Validate staff session
  const staff = await guardStaff(req, res);
  if (!staff) return null; // guardStaff already sent 401

  // Step 2: Verify Supabase JWT
  const user = await getUser(req, res);
  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: 'JWT_REQUIRED', message: 'Valid session token required for this operation' }
    });
    return null;
  }

  // Note: Step 3 (cross-check JWT user vs staff session) is omitted because
  // owner staff objects are synthetic (staff.id === user.id for owners).
  // guardStaff already validated the session, getUser validated the JWT.

  // Step 4: Require owner or manager role
  if (!['owner', 'manager'].includes(staff.role)) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Owner or Manager role required' }
    });
    return null;
  }

  return { ...staff, user };
}
