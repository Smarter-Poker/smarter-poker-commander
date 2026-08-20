/**
 * Tournament Entries API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 3
 * GET /api/commander/tournaments/[id]/entries - List entries
 * POST /api/commander/tournaments/[id]/entries - Register player
 * DELETE /api/commander/tournaments/[id]/entries - Unregister player
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
// 2026-07-25 audit fix: POST supports player self-registration (Bearer JWT) in
// addition to staff sessions; GET redacts PII for non-staff callers.
import { guardStaff, verifyStaffSession, getUser } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const { id: tournamentId } = req.query;

    if (!tournamentId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' } });
    }

    if (req.method === 'GET') {
      return listEntries(req, res, tournamentId);
    }

    if (req.method === 'POST') {
      // 2026-07-25 audit fix: staff session OR Bearer user (self-registration only).
      // Identity is derived from the verified session, never from the request body.
      const sessionResult = await verifyStaffSession(req);
      if (!sessionResult.error) {
        return registerPlayer(req, res, tournamentId, { staff: sessionResult.staff });
      }
      const user = await getUser(req, res);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authentication Required' }
        });
      }
      const requestedPlayerId = req.body?.player_id;
      if (requestedPlayerId && String(requestedPlayerId) !== String(user.id)) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Only Staff Can Register Other Players' }
        });
      }
      return registerPlayer(req, res, tournamentId, { user });
    }

    if (req.method === 'DELETE') {
      // 2026-07-25 audit fix: preserve prior write guard for DELETE
      const _g = await guardStaff(req, res); if (!_g) return;
      return unregisterPlayer(req, res, tournamentId);
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

async function listEntries(req, res, tournamentId) {
  try {
    const { status, check_my_entry } = req.query;

    let query = getSupabase()
      .from('commander_tournament_entries')
      .select(`
        *,
        profiles (id, display_name, avatar_url)
      `)
      .eq('tournament_id', tournamentId)
      .order('registered_at', { ascending: true })

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query;

    if (error) throw error;

    // 2026-07-25 audit fix: redact player_phone unless caller has a valid staff session
    const staffResult = await verifyStaffSession(req);
    const isStaff = !staffResult.error;
    let entries = data || [];
    if (!isStaff) {
      entries = entries.map(({ player_phone, ...rest }) => rest);
    }

    const payload = { entries };

    // 2026-07-25 audit fix: ?check_my_entry=true returns the Bearer user's own entry
    if (check_my_entry === 'true') {
      payload.my_entry = null;
      const user = await getUser(req, res);
      if (user) {
        const { data: myEntry } = await getSupabase()
          .from('commander_tournament_entries')
          .select('*')
          .eq('tournament_id', tournamentId)
          .eq('player_id', user.id)
          .neq('status', 'cancelled')
          .limit(1)
          .maybeSingle();
        payload.my_entry = myEntry || null;
      }
    }

    return res.status(200).json({ success: true, data: payload });
  } catch (error) {
    console.warn('List entries error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

async function registerPlayer(req, res, tournamentId, auth = {}) {
  try {
    // 2026-07-25 audit fix: identity comes from the handler-verified session
    // (staff session or Bearer user), never re-derived from the request body.
    const userId = auth.user?.id || null;
    const isStaffCaller = Boolean(auth.staff);

    const {
      player_id,
      player_name,
      player_phone,
      registration_method = 'app',
      table_number,
      seat_number
    } = req.body;

    // Get tournament details
    const { data: tournament, error: tournamentError } = await getSupabase()
      .from('commander_tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tournamentError || !tournament) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
    }

    // Check if registration is allowed
    if (!['scheduled', 'registering', 'running'].includes(tournament.status)) {
      return res.status(400).json({ success: false, error: { code: 'REGISTRATION_CLOSED', message: 'Registration Is Closed For This Tournament' } });
    }

    // Check late registration
    // 2026-07-25 audit fix: current_level is 0-indexed, compare level number (current_level + 1)
    if (tournament.status === 'running' && tournament.late_registration_levels != null) {
      if ((tournament.current_level + 1) > tournament.late_registration_levels) {
        return res.status(400).json({ success: false, error: { code: 'LATE_REG_CLOSED', message: 'Late Registration Period Has Ended' } });
      }
    }

    // Check physical capacity (only count people taking up a chair)
    if (tournament.max_entries) {
      const { count } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .in('status', ['registered', 'seated', 'active'])

      if (count >= tournament.max_entries) {
        return res.status(400).json({ success: false, error: { code: 'TOURNAMENT_FULL', message: 'Tournament Is Full' } });
      }
    }

    // 2026-07-25 audit fix: staff callers may register anyone; Bearer users only themselves
    const effectivePlayerId = player_id || userId;
    if (!isStaffCaller && effectivePlayerId !== userId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only Staff Can Register Other Players' } });
    }

    // Check for existing registration
    if (effectivePlayerId) {
      const { data: existing } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, status')
        .eq('tournament_id', tournamentId)
        .eq('player_id', effectivePlayerId)
        .not('status', 'in', '("eliminated","cancelled")')
        .maybeSingle();

      if (existing) {
        return res.status(400).json({ success: false, error: { code: 'ALREADY_REGISTERED', message: 'Player Is Already Registered' } });
      }
    }

    const { data: entry, error } = await getSupabase()
      .from('commander_tournament_entries')
      .insert({
        tournament_id: tournamentId,
        player_id: effectivePlayerId,
        player_name: player_name || null,
        player_phone: player_phone || null,
        registration_method,
        table_number,
        seat_number,
        status: tournament.status === 'running' ? 'active' : 'registered',
        current_chips: tournament.starting_chips
      })
      .select(`
        *,
        profiles (id, display_name, avatar_url)
      `)
      .maybeSingle();

    if (error) throw error;

    // Award XP for registration
    if (effectivePlayerId) {
      // XP system removed
    }

    return res.status(201).json({ success: true, data: { entry } });
  } catch (error) {
    console.warn('Register player error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

async function unregisterPlayer(req, res, tournamentId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authorization Required' } });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Invalid Token' } });
    }

    const { entry_id } = req.body;

    if (!entry_id) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Entry ID Required' } });
    }

    // Get entry
    const { data: entry, error: entryError } = await getSupabase()
      .from('commander_tournament_entries')
      .select('*, commander_tournaments(venue_id, status)')
      .eq('id', entry_id)
      .eq('tournament_id', tournamentId)
      .maybeSingle();

    if (entryError || !entry) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entry Not Found' } });
    }

    const tournament = entry.commander_tournaments;

    // Only allow unregister before tournament starts
    if (!['scheduled', 'registering'].includes(tournament.status)) {
      // Check if staff
      const { data: staff } = await getSupabase()
        .from('commander_staff')
        .select('id')
        .eq('venue_id', tournament.venue_id)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!staff) {
        return res.status(400).json({ success: false, error: { code: 'TOURNAMENT_STARTED', message: 'Cannot Unregister After Tournament Has Started' } });
      }
    }

    // Check if own entry or staff
    const isOwnEntry = entry.player_id === user.id;
    if (!isOwnEntry) {
      const { data: staff } = await getSupabase()
        .from('commander_staff')
        .select('id')
        .eq('venue_id', tournament.venue_id)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!staff) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access Denied' } });
      }
    }

    const { error } = await getSupabase()
      .from('commander_tournament_entries')
      .delete()
      .eq('id', entry_id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Player Unregistered' });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Unregister player error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
