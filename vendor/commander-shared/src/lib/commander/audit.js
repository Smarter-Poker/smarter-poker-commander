/**
 * Audit Logging Utilities
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6
 * Complete audit trail for all actions
 */
import { createClient } from '@supabase/supabase-js';

// Lazy getter — prevents SSG/SSR crashes when env vars aren't available at module load time.
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

/**
 * Log an audit event
 */
export async function logAudit({
  venueId,
  userId,
  staffId,
  actorType = 'user',
  action,
  actionCategory,
  targetType,
  targetId,
  targetName,
  changes,
  metadata = {},
  req
}) {
  try {
    // Extract request context if available
    const ipAddress = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
      || req?.socket?.remoteAddress;
    const userAgent = req?.headers?.['user-agent'];
    const requestId = req?.headers?.['x-request-id'];

    const { data, error } = await getSupabase().rpc('log_audit_event', {
      p_venue_id: venueId ? parseInt(venueId) : null,
      p_user_id: userId || null,
      p_staff_id: staffId || null,
      p_actor_type: actorType,
      p_action: action,
      p_action_category: actionCategory,
      p_target_type: targetType || null,
      p_target_id: targetId?.toString() || null,
      p_changes: changes || null,
      p_metadata: {
        ...metadata,
        ip_address: ipAddress,
        user_agent: userAgent,
        request_id: requestId
      }
    });

    if (error) {
      console.warn('Audit log error:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.warn('Audit log error:', err);
    return null;
  }
}

/**
 * Log categories and common actions
 */
export const AuditActions = {
  // Auth
  AUTH_LOGIN: { action: 'login', category: 'auth' },
  AUTH_LOGOUT: { action: 'logout', category: 'auth' },
  AUTH_PIN_VERIFY: { action: 'pin_verify', category: 'auth' },

  // Waitlist
  WAITLIST_JOIN: { action: 'join', category: 'waitlist' },
  WAITLIST_LEAVE: { action: 'leave', category: 'waitlist' },
  WAITLIST_CALL: { action: 'call', category: 'waitlist' },
  WAITLIST_SEAT: { action: 'seat', category: 'waitlist' },

  // Game
  GAME_OPEN: { action: 'open', category: 'game' },
  GAME_CLOSE: { action: 'close', category: 'game' },
  GAME_UPDATE: { action: 'update', category: 'game' },

  // Table
  TABLE_CREATE: { action: 'create', category: 'table' },
  TABLE_UPDATE: { action: 'update', category: 'table' },
  TABLE_DELETE: { action: 'delete', category: 'table' },

  // Tournament
  TOURNAMENT_CREATE: { action: 'create', category: 'tournament' },
  TOURNAMENT_START: { action: 'start', category: 'tournament' },
  TOURNAMENT_PAUSE: { action: 'pause', category: 'tournament' },
  TOURNAMENT_END: { action: 'end', category: 'tournament' },
  TOURNAMENT_REGISTER: { action: 'register', category: 'tournament' },
  TOURNAMENT_ELIMINATE: { action: 'eliminate', category: 'tournament' },

  // Player
  PLAYER_CHECKIN: { action: 'checkin', category: 'player' },
  PLAYER_CHECKOUT: { action: 'checkout', category: 'player' },
  PLAYER_UPDATE: { action: 'update', category: 'player' },

  // Promotion
  PROMOTION_CREATE: { action: 'create', category: 'promotion' },
  PROMOTION_AWARD: { action: 'award', category: 'promotion' },
  PROMOTION_UPDATE: { action: 'update', category: 'promotion' },

  // Comp
  COMP_ISSUE: { action: 'issue', category: 'comp' },
  COMP_REDEEM: { action: 'redeem', category: 'comp' },
  COMP_ADJUST: { action: 'adjust', category: 'comp' },

  // Settings
  SETTINGS_UPDATE: { action: 'update', category: 'settings' },

  // Staff
  STAFF_ADD: { action: 'add', category: 'staff' },
  STAFF_REMOVE: { action: 'remove', category: 'staff' },
  STAFF_UPDATE: { action: 'update', category: 'staff' },

  // Export
  EXPORT_REQUEST: { action: 'request', category: 'export' },
  EXPORT_DOWNLOAD: { action: 'download', category: 'export' },

  // Admin
  ADMIN_ACTION: { action: 'admin_action', category: 'admin' }
};

/**
 * Helper to log with predefined action
 */
export async function logAction(auditAction, params) {
  return logAudit({
    ...params,
    action: auditAction.action,
    actionCategory: auditAction.category
  });
}

/**
 * Calculate changes between old and new objects
 */
export function calculateChanges(oldObj, newObj, fields = null) {
  const changes = {};
  const fieldsToCheck = fields || Object.keys({ ...oldObj, ...newObj });

  for (const field of fieldsToCheck) {
    const oldVal = oldObj?.[field];
    const newVal = newObj?.[field];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[field] = { old: oldVal, new: newVal };
    }
  }

  return Object.keys(changes || {}).length > 0 ? changes : null;
}
