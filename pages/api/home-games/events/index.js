/**
 * Home Game Events API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/events - List events
 * POST /api/commander/home-games/events - Create event
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';

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

    if (req.method === 'GET') {
      return listEvents(req, res);
    }

    if (req.method === 'POST') {
      return createEvent(req, res);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listEvents(req, res) {
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

    const safeP = (v) => Array.isArray(v) ? v[0] : v;
    const group_id = safeP(req.query.group_id);
    const upcoming = safeP(req.query.upcoming);
    const host_id = safeP(req.query.host_id);

    // Get user's group memberships
    const { data: memberships } = await getSupabase()
      .from('commander_home_members')
      .select('group_id')
      .eq('user_id', user.id)
      .eq('status', 'approved')
          .limit(100);

    const groupIds = memberships?.map(m => m.group_id) || [];

    if (groupIds.length === 0) {
      return res.status(200).json({ events: [] });
    }

    let query = getSupabase()
      .from('commander_home_games')
      .select(`
        *,
        commander_home_groups (id, name),
        profiles:host_id (id, display_name, avatar_url),
        commander_home_rsvps (id, user_id, response)
      `)
      .in('group_id', groupIds)
      .neq('status', 'cancelled')
      .order('scheduled_date', { ascending: true })
          .limit(100);

    if (group_id) {
      query = query.eq('group_id', group_id)
          .limit(100);
    }

    if (upcoming === 'true') {
      query = query.gte('scheduled_date', new Date().toISOString().split('T')[0]);
    }

    if (host_id) {
      query = query.eq('host_id', host_id);
    }

    const { data, error } = await query.limit(50);

    if (error) throw error;

    // Add user's RSVP status
    data?.forEach(event => {
      const myRsvp = event.commander_home_rsvps?.find(r => r.user_id === user.id);
      event.my_rsvp = myRsvp?.response || null;
      // Clean up the full rsvp list (just keep count)
      delete event.commander_home_rsvps;
    });

    return res.status(200).json({ events: data });
  } catch (error) {
    console.warn('List events error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createEvent(req, res) {
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

    const {
      group_id,
      title,
      description,
      game_type,
      stakes,
      buyin_min,
      buyin_max,
      scheduled_date,
      start_time,
      end_time,
      address,
      address_visible_to,
      location_notes,
      max_players,
      min_players,
      allow_guests,
      guest_limit,
      food_drinks,
      special_rules,
      settings
    } = req.body;

    if (!group_id || !scheduled_date || !start_time) {
      return res.status(400).json({
        error: 'Required: group_id, scheduled_date, start_time'
      });
    }

    // Check if user can host
    const { data: membership } = await getSupabase()
      .from('commander_home_members')
      .select('role, can_host')
      .eq('group_id', group_id)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .maybeSingle();

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const canHost = membership.role === 'owner' ||
      membership.role === 'admin' ||
      membership.can_host;

    if (!canHost) {
      return res.status(403).json({ error: 'You do not have permission to host games' });
    }

    // Get group defaults
    const { data: group } = await getSupabase()
      .from('commander_home_groups')
      .select('default_game_type, default_stakes, max_players')
      .eq('id', group_id)
      .maybeSingle();

    const { data: event, error } = await getSupabase()
      .from('commander_home_games')
      .insert({
        group_id,
        host_id: user.id,
        title: title || 'Home Game',
        description,
        game_type: game_type || group?.default_game_type || 'nlhe',
        stakes: stakes || group?.default_stakes,
        buyin_min,
        buyin_max,
        scheduled_date,
        start_time,
        end_time,
        address,
        address_visible_to: address_visible_to || 'rsvp',
        location_notes,
        max_players: max_players || group?.max_players || 9,
        min_players: min_players || 4,
        allow_guests: allow_guests || false,
        guest_limit: guest_limit || 1,
        food_drinks,
        special_rules,
        settings: settings || {},
        status: 'scheduled'
      })
      .select(`
        *,
        commander_home_groups (id, name),
        profiles:host_id (id, display_name, avatar_url)
      `)
      .maybeSingle();

    if (error) throw error;

    // Auto-RSVP host as yes
    await getSupabase()
      .from('commander_home_rsvps')
      .insert({
        game_id: event.id,
        user_id: user.id,
        response: 'yes',
        is_confirmed: true
      });

    return res.status(201).json({ event });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Create event error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
