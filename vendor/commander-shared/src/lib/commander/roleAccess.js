/**
 * Commander role and route access - pure data and helpers, no server code.
 *
 * Split out of lib/commander/auth.js (2026-11-28). CommanderLayout runs in the
 * browser on every staff page and only needs canRoleAccessRoute and
 * isSensitiveRoute, but importing them from auth.js pulled the whole server
 * module into the client bundle: node `crypto` (webpack's crypto-browserify
 * polyfill, ~325 KB raw / ~100 KB gzip), @supabase/auth-helpers-nextjs and the
 * service-role client factory. Client code imports from here; auth.js
 * re-exports everything below unchanged, so server callers are unaffected.
 * Keep this file free of imports.
 */

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

// ── Sensitive Routes - ALWAYS require PIN challenge, even for owners/managers ──
// These are OWNER/MANAGER-ONLY pages that expose confidential data (employee PINs,
// venue config, business intelligence). They require a per-session PIN verification
// regardless of cached staff session. Pages that floor, cashier, or dualrate staff
// need access to are NOT included here - those rely on the standard role gate.
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
    '/commander/dealer-rotation', '/commander/table-tablets', '/commander/print-station',
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
    '/commander/dealer-rotation', '/commander/table-tablets', '/commander/print-station',
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
    '/commander/table-tablets', '/commander/print-station',
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
