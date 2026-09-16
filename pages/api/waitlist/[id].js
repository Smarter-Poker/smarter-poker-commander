/**
 * Waitlist Entry API
 * GET /api/commander/waitlist/[id] - Get a single waitlist entry
 * DELETE /api/commander/waitlist/[id] - Remove player from waitlist (player or staff)
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff, verifyStaffSession, getUser } from '../../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const { id } = req.query;

    // ── GET: Return a single waitlist entry ───────────────────────
    // 2026-08-20 audit fix: this GET was fully public and selected '*', which
    // includes player_name and player_phone - any entry id leaked a phone
    // number.
    //
    // 2026-08-20 regression fix: the first cut of that fix returned 401 to
    // anyone who was neither venue staff nor the signed-in owner of the entry,
    // which killed /commander/waitlist/status/[id] - the page a walk-in opens
    // on their phone after joining at the desk. That player has no account and
    // no staff session, and the page header has always said "no login required,
    // the URL serves as auth token".
    //
    // Three tiers now:
    //   verified venue staff  -> the full row
    //   the entry's own player -> the full row (Bearer JWT matches player_id)
    //   holder of the link     -> display fields only. No phone, no notes, no
    //                             player_id, no staff-facing counters. The id
    //                             is an unguessable uuid, which is the token.
    // queue_position is computed server-side for every tier so the status page
    // no longer needs the venue-wide list read (which is staff-only).
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

        const sessionResult = await verifyStaffSession(req);
        const staff = sessionResult.error ? null : sessionResult.staff;
        const isVenueStaff = !!(staff && (staff.venue_id === undefined || staff.venue_id === null
          || String(staff.venue_id) === String(data.venue_id)));

        let isOwnEntry = false;
        if (!isVenueStaff && data.player_id) {
          const user = await getUser(req, res);
          isOwnEntry = !!(user && String(user.id) === String(data.player_id));
        }

        // Place in line among players still waiting for the same game.
        let queuePosition = null;
        if (data.status === 'waiting') {
          const { data: queue } = await getSupabase()
            .from('commander_waitlist')
            .select('id, created_at')
            .eq('venue_id', data.venue_id)
            .eq('game_type', data.game_type)
            .eq('status', 'waiting')
            .order('created_at', { ascending: true })
            .limit(500);
          const idx = (queue || []).findIndex(w => String(w.id) === String(data.id));
          if (idx >= 0) queuePosition = idx + 1;
        }

        if (isVenueStaff || isOwnEntry) {
          return res.status(200).json({ success: true, data, queue_position: queuePosition });
        }

        return res.status(200).json({
          success: true,
          data: {
            id: data.id,
            venue_id: data.venue_id,
            player_name: data.player_name,
            game_type: data.game_type,
            stakes: data.stakes,
            status: data.status,
            created_at: data.created_at,
            checked_in_at: data.checked_in_at,
            seated_at: data.seated_at,
            last_called_at: data.last_called_at || data.last_called,
            estimated_wait_minutes: data.estimated_wait_minutes
          },
          queue_position: queuePosition
        });
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

        // 2026-08-20 audit fix: this used to JSON.parse the raw x-staff-session
        // header and look the claimed staff id straight up in commander_staff,
        // with no HMAC check and no venue scoping - a forged header holding any
        // staff row id could delete any venue's waitlist entries.
        // verifyStaffSession validates the signature and the TTL, and the
        // entry's venue must match the session's venue.
        const sessionResult = await verifyStaffSession(req);
        if (sessionResult.staff) {
          const staffRow = sessionResult.staff;
          if (staffRow.venue_id === undefined || staffRow.venue_id === null
              || String(staffRow.venue_id) === String(entry.venue_id)) {
            authorized = true;
            actingStaffId = staffRow.id;
          }
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
        // 2026-08-20 audit fix: the old inline check re-parsed the UNSIGNED
        // x-staff-session header (guardWriteStaff above already verified the
        // signed session) and never checked that the entry belonged to the
        // caller's venue, so any staff member could edit - including rewriting
        // player_phone on - any other venue's waitlist entries.
        const { data: target } = await getSupabase()
          .from('commander_waitlist')
          .select('id, venue_id')
          .eq('id', id)
          .maybeSingle();

        if (!target) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Waitlist Entry Not Found' } });
        }

        if (staff.venue_id !== undefined && staff.venue_id !== null
            && String(staff.venue_id) !== String(target.venue_id)) {
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' } });
        }

        // Only allow specific fields to be updated
        const allowedFields = ['checked_in_at', 'notes', 'player_phone', 'game_type', 'stakes'];
        const updates = {};
        for (const key of allowedFields) {
          if (req.body[key] !== undefined) {
            updates[key] = key === 'game_type' ? (req.body[key] || '').toLowerCase() : req.body[key];
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
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
