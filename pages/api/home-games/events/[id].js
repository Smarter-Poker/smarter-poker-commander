/**
 * Single Home Game Event API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/events/[id] - Get event details
 * PUT /api/commander/home-games/events/[id] - Update event
 * DELETE /api/commander/home-games/events/[id] - Cancel event
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'GET') { const _u = await guardUser(req, res); if (!_u) return; }

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Event ID required' });
    }

    if (req.method === 'GET') {
      return getEvent(req, res, id);
    }

    if (req.method === 'PUT') {
      return updateEvent(req, res, id);
    }

    if (req.method === 'DELETE') {
      return cancelEvent(req, res, id);
    }

    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getEvent(req, res, id) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const { data: event, error } = await getSupabase()
      .from('commander_home_games')
      .select(`
        *,
        commander_home_groups (id, name, owner_id),
        profiles:host_id (id, display_name, avatar_url),
        commander_home_rsvps (
          id, user_id, response, bringing_guests, message, is_confirmed,
          profiles:user_id (id, display_name, avatar_url)
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error || !event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Check if user is a member
    const { data: membership } = await getSupabase()
      .from('commander_home_members')
      .select('role, status')
      .eq('group_id', event.group_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership || membership.status !== 'approved') {
      return res.status(403).json({ success: false, error: 'You are not a member of this group' });
    }

    // Find user's RSVP
    const myRsvp = event.commander_home_rsvps?.find(r => r.user_id === user.id);

    // DEFENSIVE: Ensure host profile exists
    if (!event.profiles) {
      event.profiles = { id: event.host_id, display_name: 'Unknown Host', avatar_url: null };
    }

    // DEFENSIVE: Ensure all RSVP profiles exist
    if (event.commander_home_rsvps) {
      event.commander_home_rsvps = event.commander_home_rsvps.map(rsvp => ({
        ...rsvp,
        profiles: rsvp.profiles || { id: rsvp.user_id, display_name: 'Guest', avatar_url: null }
      }));
    }

    // Check if user can see address
    let showAddress = false;
    if (event.address_visible_to === 'all') {
      showAddress = true;
    } else if (event.address_visible_to === 'rsvp' && myRsvp?.response === 'yes') {
      showAddress = true;
    } else if (event.address_visible_to === 'approved' && myRsvp?.is_confirmed) {
      showAddress = true;
    } else if (event.host_id === user.id) {
      showAddress = true;
    }

    if (!showAddress) {
      event.address = null;
    }

    const isHost = event.host_id === user.id;
    const isAdmin = membership.role === 'owner' || membership.role === 'admin';

    return res.status(200).json({
      event,
      my_rsvp: myRsvp || null,
      can_edit: isHost || isAdmin,
      is_host: isHost
    });
  } catch (error) {
    console.warn('Get event error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function updateEvent(req, res, id) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Get event
    const { data: event } = await getSupabase()
      .from('commander_home_games')
      .select('host_id, group_id, status')
      .eq('id', id)
      .maybeSingle();

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Check permissions
    const isHost = event.host_id === user.id;

    const { data: membership } = await getSupabase()
      .from('commander_home_members')
      .select('role')
      .eq('group_id', event.group_id)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .maybeSingle();

    const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';

    if (!isHost && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Only the host or admins can update this event' });
    }

    const { action } = req.body;

    // Handle special actions
    if (action === 'start') {
      const { data: updated, error } = await getSupabase()
        .from('commander_home_games')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;

      return res.status(200).json({ event: updated, message: 'Game started' });
    }

    if (action === 'complete') {
      const { data: updated, error } = await getSupabase()
        .from('commander_home_games')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;

      // XP system removed

      // Award XP to attendees
      const { data: attendees } = await getSupabase()
        .from('commander_home_rsvps')
        .select('user_id')
        .eq('game_id', id)
        .eq('response', 'yes')
        .eq('is_confirmed', true);

      for (const attendee of attendees || []) {
        if (attendee.user_id !== event.host_id) {
          // XP system removed
        }
      }

      // Update member stats
      // 2026-07-25 audit fix: supabase rpc() reports failures via the returned
      // error, not a rejection — log it (non-fatal) instead of swallowing.
      try {
        const { error: statsError } = await getSupabase().rpc('increment_home_game_stats', {
          p_game_id: id
        });
        if (statsError) {
          console.warn(`increment_home_game_stats failed for game ${id}:`, statsError.message || statsError);
        }
      } catch (e) {
        console.warn(`increment_home_game_stats failed for game ${id}:`, e?.message || e);
      }

      return res.status(200).json({ event: updated, message: 'Game completed' });
    }

    // Regular update — explicit ALLOW-LIST, same pattern as groups/[id] F67.
    // Prior code took the full req.body, stripped 8 fields, and wrote the
    // rest. A host could smuggle:
    //   • status                  — bypass start/complete/cancel actions,
    //                               revert a completed game back to scheduled
    //   • cancelled_at            — backdate a cancellation to dodge flake
    //                               strikes or refund policies
    //   • address_visible_to      — arbitrary value (CHECK would catch most
    //                               but any valid enum change bypasses UX)
    //   • completed_at            — fake completion timestamp
    //   • rsvp_closes_at          — edit without the safety checks the UI
    //                               would normally impose
    // Allow-list covers every field the "edit event" UI actually exposes.
    const EDITABLE = [
      'title',
      'description',
      'game_type',
      'stakes',
      'buyin_min',
      'buyin_max',
      'scheduled_date',
      'start_time',
      'end_time',
      'address',
      'address_visible_to',
      'location_notes',
      'max_players',
      'min_players',
      'allow_guests',
      'guest_limit',
      'food_drinks',
      'special_rules',
      'settings',
      'rsvp_closes_at',
    ];
    const body = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    for (const key of EDITABLE) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        updates[key] = body[key];
      }
    }

    // Validate address_visible_to if present — DB CHECK exists but we want
    // a clean 400 rather than a 500.
    if (Object.prototype.hasOwnProperty.call(updates, 'address_visible_to')) {
      const ALLOWED_AVT = ['all','rsvp','approved'];
      if (typeof updates.address_visible_to !== 'string' ||
          !ALLOWED_AVT.includes(updates.address_visible_to)) {
        return res.status(400).json({
          success: false,
          error: `address_visible_to must be one of: ${ALLOWED_AVT.join(', ')}`
        });
      }
    }

    const { data: updated, error } = await getSupabase()
      .from('commander_home_games')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ event: updated });
  } catch (error) {
    console.warn('Update event error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function cancelEvent(req, res, id) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Get event
    const { data: event } = await getSupabase()
      .from('commander_home_games')
      .select('host_id, group_id')
      .eq('id', id)
      .maybeSingle();

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Check permissions
    const isHost = event.host_id === user.id;

    const { data: membership } = await getSupabase()
      .from('commander_home_members')
      .select('role')
      .eq('group_id', event.group_id)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .maybeSingle();

    const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';

    if (!isHost && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Only the host or admins can cancel this event' });
    }

    const { error } = await getSupabase()
      .from('commander_home_games')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Event cancelled' });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Cancel event error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
