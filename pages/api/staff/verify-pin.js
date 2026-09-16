/**
 * Commander Verify PIN API - POST /api/commander/staff/verify-pin
 * Verify staff PIN for terminal login
 * 
 * SECURITY:
 * - Rate limited: 5 attempts per minute per IP
 * - Lockout after 10 consecutive failures (5 min cooldown)
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { DEFAULT_PERMISSIONS, signStaffSession } from '../../../src/lib/commander/auth';
import { logAction, AuditActions } from '../../../src/lib/commander/audit';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Rate limiting lives in Postgres (commander_rate_limits, via fn_rate_limit_hit),
// NOT in process memory. The previous in-memory Map gave every Vercel lambda
// instance its own counter and reset on each deploy, so a burst spread across
// instances was never throttled: 14 consecutive wrong-PIN attempts reached
// production with zero lockouts. A shared counter closes that brute-force path.
const MAX_PER_MINUTE = 5;
const WINDOW_MINUTES = 1;
const LOCKOUT_MINUTES = 5;

function getKey(req, venueId) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
  return `${ip}:${venueId}`;
}

async function checkRate(key) {
  const { data, error } = await getSupabase().rpc('fn_rate_limit_hit', {
    p_identifier: key,
    p_endpoint: 'staff/verify-pin',
    p_max_requests: MAX_PER_MINUTE,
    p_window_minutes: WINDOW_MINUTES,
    p_lockout_minutes: LOCKOUT_MINUTES,
  });

  // Fail OPEN if the limiter itself errors: PIN verification depends on this same
  // database, so a hard failure here would lock out every legitimate staff member
  // without adding any protection. Log loudly instead.
  if (error) {
    console.warn('[verify-pin] rate limiter unavailable:', error.message || error);
    return { ok: true };
  }

  if (data && data.allowed === false) {
    return { ok: false, retry: data.retry_after || 60, reason: data.reason || 'RATE_LIMITED' };
  }
  return { ok: true };
}

// Venue-scoped FAILURE throttle. Per-IP limiting alone does not stop a
// distributed attack: a burst from a rotating pool of source IPs gives each IP
// its own counter, so none reaches the threshold (measured against production).
// The venue being guessed cannot be rotated, so it is throttled too. Only
// FAILURES count, so a busy room's successful logins never trip it, and the
// threshold is generous so an attacker cannot cheaply lock a room's staff out.
const VENUE_MAX_FAILURES = 25;
const VENUE_WINDOW_MINUTES = 5;
const VENUE_LOCKOUT_MINUTES = 2;
const VENUE_FAIL_ENDPOINT = 'staff/verify-pin:fail';

async function venueLockoutSeconds(venueId) {
  const { data, error } = await getSupabase().rpc('fn_rate_limit_blocked', {
    p_identifier: `venue:${venueId}`,
    p_endpoint: VENUE_FAIL_ENDPOINT,
    p_identifier_type: 'venue',
  });
  if (error) {
    console.warn('[verify-pin] venue lockout check unavailable:', error.message || error);
    return 0;
  }
  return Number(data) || 0;
}

async function recordVenueFailure(venueId) {
  const { error } = await getSupabase().rpc('fn_rate_limit_hit', {
    p_identifier: `venue:${venueId}`,
    p_endpoint: VENUE_FAIL_ENDPOINT,
    p_max_requests: VENUE_MAX_FAILURES,
    p_window_minutes: VENUE_WINDOW_MINUTES,
    p_lockout_minutes: VENUE_LOCKOUT_MINUTES,
    p_identifier_type: 'venue',
  });
  if (error) {
    console.warn('[verify-pin] venue failure counter unavailable:', error.message || error);
  }
}

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }

    try {
      const { venue_id, pin_code } = req.body;
      if (!venue_id || !pin_code) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'venue_id and pin_code are required' } });
      }

      const key = getKey(req, venue_id);
      const rl = await checkRate(key);
      if (!rl.ok) {
        res.setHeader('Retry-After', rl.retry);
        return res.status(429).json({
          success: false,
          error: { code: rl.reason, message: `Too many attempts. Try again in ${rl.retry}s.` }
        });
      }

      // Distributed-attack guard: too many recent FAILURES against this venue
      // from any source. Peek only - this check never increments the counter.
      const venueLock = await venueLockoutSeconds(venue_id);
      if (venueLock > 0) {
        res.setHeader('Retry-After', venueLock);
        return res.status(429).json({
          success: false,
          error: { code: 'VENUE_LOCKED_OUT', message: `Too many failed attempts. Try again in ${venueLock}s.` }
        });
      }

      // 2026-08-07 security fix: this compared the PLAINTEXT `pin_code` column.
      // PINs are now bcrypt-hashed into commander_staff.pin_hash (a BEFORE
      // INSERT/UPDATE trigger keeps future writes hashed). fn_verify_staff_pin
      // matches the hash and falls back to the legacy plaintext column for any
      // row not yet hashed, so no staff member can be locked out mid-migration.
      const { data: staffId, error: rpcError } = await getSupabase()
        .rpc('fn_verify_staff_pin', { p_venue_id: String(venue_id), p_pin: String(pin_code) });

      let staff = null;
      let error = rpcError;

      if (!rpcError && staffId) {
        const { data: staffRow, error: rowError } = await getSupabase()
          .from('commander_staff')
          .select('id, venue_id, role, is_active, display_name, permissions, profiles ( id, display_name, avatar_url )')
          .eq('id', staffId)
          .maybeSingle();
        staff = staffRow || null;
        error = rowError;
      }

      if (error || !staff) {
        await recordVenueFailure(venue_id);
        return res.status(200).json({ success: true, data: { valid: false, staff: null, permissions: null } });
      }

      const permissions = { ...DEFAULT_PERMISSIONS[staff.role], ...(staff.permissions || {}) };
      const name = staff.profiles?.display_name || staff.display_name || staff.role.charAt(0).toUpperCase() + staff.role.slice(1);

      // Audit log
      await logAction(AuditActions.AUTH_PIN_VERIFY, {
        venueId: venue_id,
        staffId: staff.id,
        targetId: staff.id,
        targetType: 'commander_staff',
        targetName: name,
        req
      });

      return res.status(200).json({
        success: true,
        data: {
          valid: true,
          // 2026-07-25 audit fix: staff sessions are now HMAC-signed
          // server-side. verifyStaffSession rejects any x-staff-session
          // without a valid `sig`, so forged headers no longer authenticate.
          staff: signStaffSession({
            id: staff.id,
            role: staff.role,
            venue_id: staff.venue_id,
            user_id: staff.profiles?.id || null,
            display_name: name,
            avatar_url: staff.profiles?.avatar_url || null,
          }),
          permissions
        }
      });
    } catch (error) {
      console.warn('Commander verify PIN error:', error);
      return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
