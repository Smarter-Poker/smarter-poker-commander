/**
 * Home Game RSVP API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/events/[id]/rsvp - Get RSVPs
 * POST /api/commander/home-games/events/[id]/rsvp - Submit RSVP
 * PUT /api/commander/home-games/events/[id]/rsvp - Update RSVP (confirm, waitlist management)
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/sentryWrap';

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

    const { id: eventId } = req.query;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID required' });
    }

    if (req.method === 'GET') {
      return getRsvps(req, res, eventId);
    }

    if (req.method === 'POST') {
      return submitRsvp(req, res, eventId);
    }

    if (req.method === 'PUT') {
      return updateRsvp(req, res, eventId);
    }

    res.setHeader('Allow', ['GET', 'POST', 'PUT']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getRsvps(req, res, eventId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get event and check membership
    const { data: event } = await getSupabase()
      .from('commander_home_games')
      .select('group_id, host_id')
      .eq('id', eventId)
      .maybeSingle();

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const { data: membership } = await getSupabase()
      .from('commander_home_members')
      .select('role')
      .eq('group_id', event.group_id)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .maybeSingle();

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const { data: rsvps, error } = await getSupabase()
      .from('commander_home_rsvps')
      .select(`
        *,
        profiles:user_id (id, display_name, avatar_url)
      `)
      .eq('game_id', eventId)
      .order('responded_at', { ascending: true })
          .limit(100);

    if (error) throw error;

    // Group by response
    const grouped = {
      yes: rsvps?.filter(r => r.response === 'yes') || [],
      maybe: rsvps?.filter(r => r.response === 'maybe') || [],
      no: rsvps?.filter(r => r.response === 'no') || [],
      waitlist: rsvps?.filter(r => r.response === 'waitlist') || []
    };

    // Find user's RSVP
    const myRsvp = rsvps?.find(r => r.user_id === user.id);

    return res.status(200).json({
      rsvps: grouped,
      my_rsvp: myRsvp || null,
      is_host: event.host_id === user.id
    });
  } catch (error) {
    console.warn('Get RSVPs error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function submitRsvp(req, res, eventId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { response, bringing_guests, guest_names, message } = req.body;

    if (!response || !['yes', 'maybe', 'no'].includes(response)) {
      return res.status(400).json({ error: 'Valid response required (yes, maybe, no)' });
    }

    // Get event
    const { data: event, error: eventError } = await getSupabase()
      .from('commander_home_games')
      .select('group_id, host_id, max_players, rsvp_yes, allow_guests, guest_limit, status, scheduled_date, start_time, rsvp_closes_at, cancelled_at')
      .eq('id', eventId)
      .maybeSingle();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // phase40: time-window enforcement. Only 'scheduled' and 'confirmed' states
    // are joinable. Draft is host-only; in_progress/completed/cancelled are
    // past the point of RSVP. Belt + suspenders on cancelled_at in case status
    // ever drifts from cancelled_at.
    if (event.status !== 'scheduled' && event.status !== 'confirmed') {
      return res.status(400).json({ error: 'This event is no longer accepting RSVPs' });
    }
    if (event.cancelled_at) {
      return res.status(400).json({ error: 'This event has been cancelled' });
    }
    // Hard deadline if host set one (unambiguous timestamptz)
    if (event.rsvp_closes_at && new Date(event.rsvp_closes_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'RSVPs are closed for this event' });
    }
    // Belt-and-suspenders: even if status wasn't flipped by the status cron,
    // reject RSVPs to past-date events. scheduled_date is a DATE column; we
    // compare against today in UTC. Edge case: if a cron hasn't run, a host
    // could still accept RSVPs for games that already happened, which would
    // pollute flake-strike logic and review-eligibility checks.
    if (event.scheduled_date) {
      const todayUTC = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      if (String(event.scheduled_date) < todayUTC) {
        return res.status(400).json({ error: 'This event has already happened' });
      }
    }

    // Check membership
    const { data: membership } = await getSupabase()
      .from('commander_home_members')
      .select('role')
      .eq('group_id', event.group_id)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .maybeSingle();

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    // Check capacity for "yes" responses
    let finalResponse = response;
    if (response === 'yes') {
      const totalGuests = bringing_guests || 0;
      const spotsNeeded = 1 + totalGuests;

      // Validate guest count
      if (totalGuests > 0) {
        if (!event.allow_guests) {
          return res.status(400).json({ error: 'Guests are not allowed at this event' });
        }
        if (totalGuests > event.guest_limit) {
          return res.status(400).json({ error: `Maximum ${event.guest_limit} guest(s) allowed` });
        }
      }

      // Check if there's room
      if (event.rsvp_yes + spotsNeeded > event.max_players) {
        // Put on waitlist instead
        finalResponse = 'waitlist';
      }
    }

    // Check for existing RSVP
    const { data: existing } = await getSupabase()
      .from('commander_home_rsvps')
      .select('id')
      .eq('game_id', eventId)
      .eq('user_id', user.id)
      .maybeSingle();

    let rsvp;
    if (existing) {
      // Update existing
      const { data, error } = await getSupabase()
        .from('commander_home_rsvps')
        .update({
          response: finalResponse,
          bringing_guests: bringing_guests || 0,
          guest_names: guest_names || [],
          message,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select(`
          *,
          profiles:user_id (id, display_name, avatar_url)
        `)
        .maybeSingle();

      if (error) throw error;
      rsvp = data;
    } else {
      // Create new
      const { data, error } = await getSupabase()
        .from('commander_home_rsvps')
        .insert({
          game_id: eventId,
          user_id: user.id,
          response: finalResponse,
          bringing_guests: bringing_guests || 0,
          guest_names: guest_names || [],
          message,
          is_confirmed: event.host_id === user.id // Auto-confirm host
        })
        .select(`
          *,
          profiles:user_id (id, display_name, avatar_url)
        `)
        .maybeSingle();

      if (error) throw error;
      rsvp = data;
    }

    return res.status(200).json({
      rsvp,
      message: finalResponse === 'waitlist'
        ? 'Added to waitlist - the event is currently full'
        : 'RSVP submitted'
    });
  } catch (error) {
    console.warn('Submit RSVP error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateRsvp(req, res, eventId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { rsvp_id, action, seat_number } = req.body;

    if (!rsvp_id || !action) {
      return res.status(400).json({ error: 'rsvp_id and action required' });
    }

    // Get event and RSVP
    const { data: rsvp } = await getSupabase()
      .from('commander_home_rsvps')
      .select('*, commander_home_games(group_id, host_id, max_players, rsvp_yes)')
      .eq('id', rsvp_id)
      .eq('game_id', eventId)
      .maybeSingle();

    if (!rsvp) {
      return res.status(404).json({ error: 'RSVP not found' });
    }

    const event = rsvp.commander_home_games;

    // Check if user is host
    if (event.host_id !== user.id) {
      // Check if admin
      const { data: membership } = await getSupabase()
        .from('commander_home_members')
        .select('role')
        .eq('group_id', event.group_id)
        .eq('user_id', user.id)
        .eq('status', 'approved')
        .maybeSingle();

      if (membership?.role !== 'owner' && membership?.role !== 'admin') {
        return res.status(403).json({ error: 'Only the host or admins can manage RSVPs' });
      }
    }

    let updates = {};

    // Validate seat_number when the action would write one. The RSVP seat_number
    // column has NO DB CHECK constraint, so garbage input (strings, floats,
    // negatives, seat 999) would otherwise succeed silently and break the
    // seating UI. Range is bounded by event.max_players (2–10 per the game
    // tables CHECK; we use the specific event's configured max).
    const writesSeat = (action === 'confirm' || action === 'set_seat');
    if (writesSeat && seat_number != null) {
      const n = Number(seat_number);
      if (!Number.isInteger(n) || n < 1 || n > (event.max_players || 10)) {
        return res.status(400).json({
          error: `seat_number must be an integer between 1 and ${event.max_players || 10}`
        });
      }
    }

    switch (action) {
      case 'confirm':
        updates = { is_confirmed: true, seat_number };
        break;

      case 'unconfirm':
        updates = { is_confirmed: false, seat_number: null };
        break;

      case 'move_from_waitlist':
        // Check capacity
        if (event.rsvp_yes >= event.max_players) {
          return res.status(400).json({ error: 'Event is at capacity' });
        }
        updates = { response: 'yes' };
        break;

      case 'move_to_waitlist':
        updates = { response: 'waitlist', is_confirmed: false };
        break;

      case 'set_seat':
        updates = { seat_number };
        break;

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error } = await getSupabase()
      .from('commander_home_rsvps')
      .update(updates)
      .eq('id', rsvp_id)
      .select(`
        *,
        profiles:user_id (id, display_name, avatar_url)
      `)
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ rsvp: updated });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Update RSVP error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
