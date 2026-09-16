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
import { reportApiError } from '../../../../../src/lib/apiErrorHandler';
import { respondToMembershipRpcError } from '../../../../../src/lib/home-games/membershipRpcError';
import {
  isHomeGamesUuid,
  resolveGroupMembershipAccess,
} from '../../../../../src/lib/home-games/membershipBoundary';
import {
  groupManagerRsvps,
  MANAGER_RSVP_SELECT,
  toManagerRsvpDto,
} from '../../../../../src/lib/home-games/rsvpBoundary';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

const RSVP_WITH_EVENT_SELECT = `
  id,
  game_id,
  user_id,
  response,
  is_confirmed,
  bringing_guests,
  guest_names,
  message,
  seat_number,
  responded_at,
  updated_at,
  commander_home_games (group_id, host_id, max_players, rsvp_yes)
`;

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'GET') { const _u = await guardUser(req, res); if (!_u) return; }

    const { id: eventId } = req.query;

    if (!isHomeGamesUuid(eventId)) {
      return res.status(400).json({ error: 'Valid event ID required' });
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
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
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

    // Only the event host, canonical group owner, or an approved group admin
    // may read the full RSVP roster and its private messages/guest names.
    const { data: event, error: eventError } = await getSupabase()
      .from('commander_home_games')
      .select('group_id, host_id')
      .eq('id', eventId)
      .maybeSingle();
    if (eventError) throw eventError;

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const [groupResult, membershipResult] = await Promise.all([
      getSupabase()
        .from('commander_home_groups')
        .select('id, owner_id')
        .eq('id', event.group_id)
        .maybeSingle(),
      getSupabase()
        .from('commander_home_members')
        .select('role, status')
        .eq('group_id', event.group_id)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    if (groupResult.error) throw groupResult.error;
    if (membershipResult.error) throw membershipResult.error;
    if (!groupResult.data) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const access = resolveGroupMembershipAccess({
      ownerId: groupResult.data.owner_id,
      userId: user.id,
      membership: membershipResult.data,
    });
    const mayManageRsvps = event.host_id === user.id || access.isManager;
    if (!mayManageRsvps) {
      return res.status(403).json({ error: 'Only the event host or group managers can view RSVPs' });
    }

    const { data: rsvps, error } = await getSupabase()
      .from('commander_home_rsvps')
      .select(MANAGER_RSVP_SELECT)
      .eq('game_id', eventId)
      .order('responded_at', { ascending: true })
      .limit(100);

    if (error) throw error;

    const normalizedRsvps = (rsvps || []).map(toManagerRsvpDto).filter(Boolean);
    const grouped = groupManagerRsvps(normalizedRsvps);

    // Find user's RSVP
    const myRsvp = normalizedRsvps.find(r => r.user_id === user.id);

    return res.status(200).json({
      // The live World manager renders an array. Keep the grouped view under
      // an explicit key for callers that need counts by response.
      rsvps: normalizedRsvps,
      grouped,
      my_rsvp: myRsvp || null,
      is_host: mayManageRsvps,
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

    const { response, bringing_guests, guest_names, message } = req.body || {};

    if (!response || !['yes', 'maybe', 'no'].includes(response)) {
      return res.status(400).json({ error: 'Valid response required (yes, maybe, no)' });
    }

    // Get event
    const { data: event, error: eventError } = await getSupabase()
      .from('commander_home_games')
      .select('group_id, host_id, max_players, allow_guests, guest_limit, status, scheduled_date, start_time, rsvps_closed, rsvp_closes_at, cancelled_at')
      .eq('id', eventId)
      .maybeSingle();

    if (eventError) throw eventError;
    if (!event) {
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
    if (event.rsvps_closed) {
      return res.status(400).json({ error: 'RSVPs are closed for this event' });
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

    const [groupResult, membershipResult] = await Promise.all([
      getSupabase()
        .from('commander_home_groups')
        .select('id, owner_id, is_active')
        .eq('id', event.group_id)
        .maybeSingle(),
      getSupabase()
        .from('commander_home_members')
        .select('role, status')
        .eq('group_id', event.group_id)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    if (groupResult.error) throw groupResult.error;
    if (membershipResult.error) throw membershipResult.error;
    if (!groupResult.data) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (groupResult.data.is_active === false) {
      return res.status(409).json({ error: 'This group is not accepting RSVPs' });
    }

    const access = resolveGroupMembershipAccess({
      ownerId: groupResult.data.owner_id,
      userId: user.id,
      membership: membershipResult.data,
    });
    if (event.host_id !== user.id && !access.isMember) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const parsedGuestCount = Number(bringing_guests ?? 0);
    if (!Number.isInteger(parsedGuestCount) || parsedGuestCount < 0 || parsedGuestCount > 10) {
      return res.status(400).json({ error: 'bringing_guests must be an integer between 0 and 10' });
    }
    const totalGuests = response === 'yes' ? parsedGuestCount : 0;
    if (totalGuests > 0 && !event.allow_guests) {
      return res.status(400).json({ error: 'Guests are not allowed at this event' });
    }
    if (totalGuests > 0 && event.guest_limit != null && totalGuests > event.guest_limit) {
      return res.status(400).json({ error: `Maximum ${event.guest_limit} guest(s) allowed` });
    }
    if (guest_names != null && !Array.isArray(guest_names)) {
      return res.status(400).json({ error: 'guest_names must be an array' });
    }
    const normalizedGuestNames = totalGuests > 0
      ? (guest_names || [])
          .slice(0, totalGuests)
          .filter((name) => typeof name === 'string' && name.trim())
          .map((name) => name.trim().slice(0, 80))
      : [];
    if (message != null && typeof message !== 'string') {
      return res.status(400).json({ error: 'message must be a string' });
    }
    const normalizedMessage = typeof message === 'string'
      ? message.trim().slice(0, 500) || null
      : null;

    // The World migration's BEFORE trigger owns the capacity decision under
    // a parent-game row lock and counts guests. An application-side check of
    // the cached rsvp_yes row count races and can incorrectly waitlist an
    // existing RSVP, so always request the caller's intended response and
    // reconcile from the row returned by Postgres.
    const finalResponse = response;

    // Check for existing RSVP
    const { data: existing, error: existingError } = await getSupabase()
      .from('commander_home_rsvps')
      .select('id, response, is_confirmed, bringing_guests, seat_number')
      .eq('game_id', eventId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (existingError) throw existingError;

    let rsvp;
    if (existing) {
      // Update existing
      const preservesConfirmation = finalResponse === 'yes'
        && existing.response === 'yes'
        && existing.is_confirmed === true
        && totalGuests <= Number(existing.bringing_guests || 0);
      const updatePayload = {
        response: finalResponse,
        bringing_guests: totalGuests,
        guest_names: normalizedGuestNames,
        message: normalizedMessage,
        is_confirmed: event.host_id === user.id
          ? finalResponse === 'yes'
          : preservesConfirmation,
        updated_at: new Date().toISOString(),
      };
      if (!preservesConfirmation && event.host_id !== user.id) {
        updatePayload.seat_number = null;
      } else if (finalResponse !== 'yes') {
        updatePayload.seat_number = null;
      }

      const { data, error } = await getSupabase()
        .from('commander_home_rsvps')
        .update(updatePayload)
        .eq('id', existing.id)
        .select(MANAGER_RSVP_SELECT)
        .maybeSingle();

      if (error) {
        if (respondToMembershipRpcError(res, error, { includeSuccess: false })) return;
        throw error;
      }
      rsvp = data;
    } else {
      // Create new
      const { data, error } = await getSupabase()
        .from('commander_home_rsvps')
        .insert({
          game_id: eventId,
          user_id: user.id,
          response: finalResponse,
          bringing_guests: totalGuests,
          guest_names: normalizedGuestNames,
          message: normalizedMessage,
          is_confirmed: event.host_id === user.id // Auto-confirm host
        })
        .select(MANAGER_RSVP_SELECT)
        .maybeSingle();

      if (error) {
        if (respondToMembershipRpcError(res, error, { includeSuccess: false })) return;
        throw error;
      }
      rsvp = data;
    }

    const normalizedRsvp = toManagerRsvpDto(rsvp);
    if (!normalizedRsvp) {
      return res.status(502).json({ error: 'RSVP was saved but could not be loaded' });
    }

    return res.status(200).json({
      rsvp: normalizedRsvp,
      message: normalizedRsvp.response === 'waitlist'
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

    const { rsvp_id, action, seat_number } = req.body || {};

    if (!rsvp_id || !action) {
      return res.status(400).json({ error: 'rsvp_id and action required' });
    }

    // Get event and RSVP
    const { data: rsvp, error: rsvpError } = await getSupabase()
      .from('commander_home_rsvps')
      .select(RSVP_WITH_EVENT_SELECT)
      .eq('id', rsvp_id)
      .eq('game_id', eventId)
      .maybeSingle();
    if (rsvpError) throw rsvpError;

    if (!rsvp) {
      return res.status(404).json({ error: 'RSVP not found' });
    }

    const event = rsvp.commander_home_games;

    // Check if user is host
    if (event.host_id !== user.id) {
      const [groupResult, membershipResult] = await Promise.all([
        getSupabase()
          .from('commander_home_groups')
          .select('id, owner_id')
          .eq('id', event.group_id)
          .maybeSingle(),
        getSupabase()
          .from('commander_home_members')
          .select('role, status')
          .eq('group_id', event.group_id)
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);
      if (groupResult.error) throw groupResult.error;
      if (membershipResult.error) throw membershipResult.error;
      if (!groupResult.data) {
        return res.status(404).json({ error: 'Group not found' });
      }
      const access = resolveGroupMembershipAccess({
        ownerId: groupResult.data.owner_id,
        userId: user.id,
        membership: membershipResult.data,
      });
      if (!access.isManager) {
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
      .select(MANAGER_RSVP_SELECT)
      .maybeSingle();

    if (error) {
      if (respondToMembershipRpcError(res, error, { includeSuccess: false })) return;
      throw error;
    }

    const normalizedRsvp = toManagerRsvpDto(updated);
    if (!normalizedRsvp) {
      return res.status(502).json({ error: 'RSVP was updated but could not be loaded' });
    }

    return res.status(200).json({ rsvp: normalizedRsvp });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Update RSVP error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
