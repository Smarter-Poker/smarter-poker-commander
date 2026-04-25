/**
 * Waitlist Entry API
 * GET /api/commander/waitlist/[id] - Get a single waitlist entry
 * DELETE /api/commander/waitlist/[id] - Remove player from waitlist (player or staff)
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const { id } = req.query;

    // ── GET: Return a single waitlist entry (public) ──────────────
    if (req.method === 'GET') {
      try {
        const { data, error } = await getSupabase()
          .from('commander_waitlist')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (error || !data) {
          return res.status(404).json({ success: false, error: 'Waitlist entry not found' });
        }

        return res.status(200).json({ success: true, data });
      } catch (err) {
        console.warn('Waitlist entry error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // ── DELETE: Remove player from waitlist (staff OR entry owner) ─
    if (req.method === 'DELETE') {
      try {
        // Fetch entry first
        const { data: entry, error: fetchErr } = await getSupabase()
          .from('commander_waitlist')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (fetchErr || !entry) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Waitlist entry not found' } });
        }

        // Auth: Allow staff OR entry owner (player with matching player_id)
        let authorized = false;
        let actingStaffId = null;

        // Check staff auth first
        const staffSession = req.headers['x-staff-session'];
        if (staffSession) {
          try {
            const sessionData = JSON.parse(staffSession);
            if (sessionData.id) {
              const { data: staffCheck } = await getSupabase()
                .from('commander_staff')
                .select('id')
                .eq('id', sessionData.id)
                .eq('is_active', true)
                .maybeSingle();
              if (staffCheck) {
                authorized = true;
                actingStaffId = staffCheck.id;
              }
            } else if (sessionData.user_id && sessionData.venue_id) {
              const { data: staffCheck } = await getSupabase()
                .from('commander_staff')
                .select('id')
                .eq('user_id', sessionData.user_id)
                .eq('venue_id', sessionData.venue_id)
                .eq('is_active', true)
                .maybeSingle();
              if (staffCheck) {
                authorized = true;
                actingStaffId = staffCheck.id;
              }
              // Owner fallback
              if (!authorized && sessionData.role === 'owner') {
                const { data: sub } = await getSupabase()
                  .from('commander_subscriptions')
                  .select('id')
                  .eq('owner_id', sessionData.user_id)
                  .eq('venue_id', sessionData.venue_id)
                  .in('status', ['active', 'trialing'])
                  .maybeSingle();
                if (sub) authorized = true;
              }
            }
          } catch { /* invalid session */ }
        }

        // Check player ownership via Bearer token
        if (!authorized) {
          const authHeader = req.headers.authorization;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '').trim();
            let accessToken = token;
            try { const p = JSON.parse(token); if (p.access_token) accessToken = p.access_token; } catch { /* raw JWT */ }

            const supabaseAnon = createClient(
              process.env.NEXT_PUBLIC_SUPABASE_URL,
              process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            );
            const { data: authData } = await supabaseAnon.auth.getUser(accessToken);
            const user = authData?.user;
            if (user && entry.player_id && user.id === entry.player_id) {
              authorized = true;
            }
          }
        }

        if (!authorized) {
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to remove this entry' } });
        }

        // Log to history (non-blocking)
        try {
          await getSupabase().from('commander_waitlist_history').insert({
            venue_id: entry.venue_id,
            player_id: entry.player_id,
            game_type: entry.game_type,
            stakes: entry.stakes,
            wait_time_minutes: Math.round((Date.now() - new Date(entry.created_at).getTime()) / (1000 * 60)),
            was_seated: false,
            signup_method: entry.signup_method
          });
        } catch { /* history logging is non-critical */ }

        // Delete entry
        const { error: delErr } = await getSupabase().from('commander_waitlist').delete().eq('id', id);
        if (delErr) {
          return res.status(500).json({ success: false, error: { code: 'DATABASE_ERROR', message: delErr.message } });
        }

        // Audit log if deleted by staff
        if (actingStaffId) {
          await logAction(AuditActions.WAITLIST_LEAVE, {
            venueId: entry.venue_id,
            staffId: actingStaffId,
            targetId: id,
            targetType: 'commander_waitlist',
            targetName: entry.player_name || 'Player',
            req
          });
        }

        return res.status(200).json({ success: true, data: { removed: true } });
      } catch (err) {
        console.warn('Waitlist delete error:', err);
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
      }
    }

    // ── PATCH and other write methods: require staff auth ──────────
    const staff = await guardWriteStaff(req, res); if (!staff) return;

    // ── PATCH: Update waitlist entry fields (e.g. check-in) ─────────
    if (req.method === 'PATCH') {
      try {
        // Require staff auth
        const staffSession = req.headers['x-staff-session'];
        if (!staffSession) {
          return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' } });
        }

        let isStaff = false;
        try {
          const sessionData = JSON.parse(staffSession);
          if (sessionData.id) {
            const { data: staff } = await getSupabase()
              .from('commander_staff')
              .select('id, venue_id, is_active')
              .eq('id', sessionData.id)
              .eq('is_active', true)
              .maybeSingle();
            if (staff) isStaff = true;
          } else if (sessionData.user_id && sessionData.venue_id) {
            const { data: staff } = await getSupabase()
              .from('commander_staff')
              .select('id, venue_id, is_active')
              .eq('user_id', sessionData.user_id)
              .eq('venue_id', sessionData.venue_id)
              .eq('is_active', true)
              .maybeSingle();
            if (staff) isStaff = true;
            // Owner fallback
            if (!isStaff && sessionData.role === 'owner') {
              const { data: sub } = await getSupabase()
                .from('commander_subscriptions')
                .select('id')
                .eq('owner_id', sessionData.user_id)
                .eq('venue_id', sessionData.venue_id)
                .in('status', ['active', 'trialing'])
                .maybeSingle();
              if (sub) isStaff = true;
            }
          }
        } catch { /* invalid session */ }

        if (!isStaff) {
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Staff access required' } });
        }

        // Only allow specific fields to be updated
        const allowedFields = ['checked_in_at', 'notes', 'player_phone', 'game_type', 'stakes'];
        const updates = {};
        for (const key of allowedFields) {
          if (req.body[key] !== undefined) {
            updates[key] = key === 'game_type' ? (req.body[key] || '').toUpperCase() : req.body[key];
          }
        }

        if (Object.keys(updates || {}).length === 0) {
          return res.status(400).json({ success: false, error: { code: 'NO_UPDATES', message: 'No valid fields to update' } });
        }

        const { data, error } = await getSupabase()
          .from('commander_waitlist')
          .update(updates)
          .eq('id', id)
          .select()
          .maybeSingle();

        if (error) {
          return res.status(500).json({ success: false, error: { code: 'DATABASE_ERROR', message: error.message } });
        }

        // Audit log
        if (staff?.id) {
          await logAction({ action: 'update', category: 'waitlist' }, {
            venueId: data.venue_id,
            staffId: staff.id,
            targetId: id,
            targetType: 'commander_waitlist',
            targetName: data.player_name || 'Player',
            changes: updates,
            req
          });
        }

        return res.status(200).json({ success: true, data });
      } catch (err) {
        console.warn('Waitlist patch error:', err);
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
      }
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
