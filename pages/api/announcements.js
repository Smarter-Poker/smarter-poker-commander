/**
 * Announcements API — Full CRUD
 * GET    /api/commander/announcements?venue_id=X                      — List active (non-expired, started) announcements
 * GET    /api/commander/announcements?venue_id=X&include_scheduled=1  — Include future-scheduled (for management UI)
 * POST   /api/commander/announcements                                 — Create announcement
 * PATCH  /api/commander/announcements                                 — Update announcement
 * DELETE /api/commander/announcements?id=X                            — Delete announcement
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardWriteStaff, verifyStaffSession } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // For GET requests we try staff session first, then allow unauthenticated (display pages)
    // For write requests, guardWriteStaff handles auth
    let venueId = req.query.venue_id;

    if (req.method === 'GET') {
      // Try to get venue_id from staff session if not in query
      if (!venueId) {
        try {
          const result = await verifyStaffSession(req);
          if (result.staff) venueId = result.staff.venue_id;
        } catch (e) { console.warn('[App] Handled exception:', e); }
      }
      if (!venueId) return res.status(400).json({ success: false, error: 'venue_id required' });

      try {
        const { data, error } = await getSupabase()
          .from('commander_club_announcements')
          .select('*')
          .eq('venue_id', venueId)
          .order('priority', { ascending: true }) // urgent first
          .order('created_at', { ascending: false })
              .limit(100);
        if (error) throw error;

        // Filter expired and not-yet-started
        const now = new Date();
        const includeScheduled = req.query.include_scheduled === '1';
        const active = (data || []).filter(a => {
          if (a.expires_at && new Date(a.expires_at) < now) return false;
          if (!includeScheduled && a.starts_at && new Date(a.starts_at) > now) return false;
          return true;
        });

        return res.json({ success: true, data: active });
      } catch (err) {
        console.warn('Get announcements error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // Write operations require staff auth
    const staff = await guardWriteStaff(req, res);
    if (!staff) return;

    // POST — Create announcement
    if (req.method === 'POST') {
      const { venue_id: vid, title, message, type, priority, expires_at, starts_at } = req.body;
      const targetVenueId = vid || staff.venue_id;
      if (!targetVenueId || !message) {
        return res.status(400).json({ success: false, error: 'venue_id and message required' });
      }

      try {
        const insertRow = {
          venue_id: targetVenueId,
          title: title || null,
          message,
          type: type || 'general',
          priority: priority || 'normal',
          expires_at: expires_at || null,
          starts_at: starts_at || null,
        };
        // author_id references profiles(id) — only set if user_id is available
        // (PIN-based staff auth returns commander_staff.id, not profiles.id)
        if (staff.user_id) insertRow.author_id = staff.user_id;

        const { data, error } = await getSupabase()
          .from('commander_club_announcements')
          .insert(insertRow)
          .select()
          .maybeSingle();
        if (error) throw error;
        return res.json({ success: true, data: { announcement: data } });
      } catch (err) {
        console.warn('Create announcement error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // PATCH — Update announcement
    if (req.method === 'PATCH') {
      const { id, title, message, type, priority, expires_at, starts_at } = req.body;
      if (!id) return res.status(400).json({ success: false, error: 'id required' });

      try {
        // 2026-07-25 audit fix: venue-scope — the announcement must belong to
        // the staff member's venue (was updatable purely by id).
        const { data: existing, error: loadError } = await getSupabase()
          .from('commander_club_announcements')
          .select('id, venue_id')
          .eq('id', id)
          .maybeSingle();
        if (loadError) throw loadError;
        if (!existing) {
          return res.status(404).json({ success: false, error: 'Announcement not found' });
        }
        if (String(existing.venue_id) !== String(staff.venue_id)) {
          return res.status(403).json({ success: false, error: 'Not authorized for this venue' });
        }

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (message !== undefined) updates.message = message;
        if (type !== undefined) updates.type = type;
        if (priority !== undefined) updates.priority = priority;
        if (expires_at !== undefined) updates.expires_at = expires_at || null;
        if (starts_at !== undefined) updates.starts_at = starts_at || null;
        updates.updated_at = new Date().toISOString();

        if (Object.keys(updates || {}).length <= 1) {
          return res.status(400).json({ success: false, error: 'No updates provided' });
        }

        const { data, error } = await getSupabase()
          .from('commander_club_announcements')
          .update(updates)
          .eq('id', id)
          .select()
          .maybeSingle();
        if (error) throw error;
        return res.json({ success: true, data: { announcement: data } });
      } catch (err) {
        console.warn('Update announcement error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // DELETE — Remove announcement
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ success: false, error: 'id required' });

      try {
        // 2026-07-25 audit fix: venue-scope — the announcement must belong to
        // the staff member's venue (was deletable purely by id).
        const { data: existing, error: loadError } = await getSupabase()
          .from('commander_club_announcements')
          .select('id, venue_id')
          .eq('id', id)
          .maybeSingle();
        if (loadError) throw loadError;
        if (!existing) {
          return res.status(404).json({ success: false, error: 'Announcement not found' });
        }
        if (String(existing.venue_id) !== String(staff.venue_id)) {
          return res.status(403).json({ success: false, error: 'Not authorized for this venue' });
        }

        const { error } = await getSupabase()
          .from('commander_club_announcements')
          .delete()
          .eq('id', id);
        if (error) throw error;
        return res.json({ success: true });
      } catch (err) {
        console.warn('Delete announcement error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
