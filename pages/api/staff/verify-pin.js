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
import { reportApiError } from '../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// In-memory rate limit store (resets on deploy — acceptable for PIN auth)
const attempts = new Map();
const MAX_PER_MINUTE = 5;
const LOCKOUT_AFTER = 10;
const LOCKOUT_MS = 5 * 60 * 1000;

function getKey(req, venueId) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
  return `${ip}:${venueId}`;
}

function checkRate(key) {
  const now = Date.now();
  let e = attempts.get(key);
  if (!e) { e = { count: 0, start: now, fails: 0, lockUntil: 0 }; attempts.set(key, e); }
  if (e.lockUntil > now) return { ok: false, retry: Math.ceil((e.lockUntil - now) / 1000), reason: 'LOCKED_OUT' };
  if (now - e.start > 60000) { e.count = 0; e.start = now; }
  if (e.count >= MAX_PER_MINUTE) return { ok: false, retry: Math.ceil((e.start + 60000 - now) / 1000), reason: 'RATE_LIMITED' };
  e.count++;
  return { ok: true };
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
      const rl = checkRate(key);
      if (!rl.ok) {
        res.setHeader('Retry-After', rl.retry);
        return res.status(429).json({
          success: false,
          error: { code: rl.reason, message: `Too many attempts. Try again in ${rl.retry}s.` }
        });
      }

      const { data: staffRows, error } = await getSupabase()
        .from('commander_staff')
        .select('id, venue_id, role, is_active, display_name, permissions, profiles ( id, display_name, avatar_url )')
        .eq('venue_id', venue_id)
        .eq('pin_code', pin_code)
        .eq('is_active', true)
        .limit(1);

      const staff = staffRows?.[0] || null;

      if (error || !staff) {
        const e = attempts.get(key);
        if (e) { e.fails++; if (e.fails >= LOCKOUT_AFTER) { e.lockUntil = Date.now() + LOCKOUT_MS; e.fails = 0; } }
        return res.status(200).json({ success: true, data: { valid: false, staff: null, permissions: null } });
      }

      // Success — reset failures
      const e = attempts.get(key);
      if (e) e.fails = 0;

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
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
