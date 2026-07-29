/**
 * Squad Detail API
 * GET /api/commander/squads/:id
 * DELETE /api/commander/squads/:id
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


    const { id } = req.query;

    if (req.method === 'GET') {
      return handleGet(req, res, id);
    } else if (req.method === 'DELETE') {
      // 2026-07-25 audit fix: pass the verified user — the delete authorization
      // must compare the session identity, not a forgeable body player_id.
      const user = await guardUser(req, res);
      if (!user) return;
      return handleDelete(req, res, id, user);
    }

    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
    });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleGet(req, res, id) {
  try {
    // 2026-07-29 wiring fix: commander_waitlist_group_members has no FK to
    // commander_waitlist_groups and the group has no FK to poker_venues, so
    // neither can be PostgREST-embedded off the group (errors PGRST200). Fetch
    // the group, then members and venue separately, and attach.
    const { data: squad, error } = await getSupabase()
      .from('commander_waitlist_groups')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !squad) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Squad not found' }
      });
    }

    // Members (the nested profiles embed off members is valid: player_id -> profiles FK)
    const { data: members } = await getSupabase()
      .from('commander_waitlist_group_members')
      .select('id, player_id, joined_at, profiles (id, display_name, avatar_url)')
      .eq('group_id', id);
    squad.commander_waitlist_group_members = members || [];

    // Venue
    if (squad.venue_id) {
      const { data: venue } = await getSupabase()
        .from('poker_venues')
        .select('id, name, city, state')
        .eq('id', squad.venue_id)
        .maybeSingle();
      squad.poker_venues = venue || null;
    } else {
      squad.poker_venues = null;
    }

    return res.status(200).json({
      success: true,
      data: { squad }
    });
  } catch (error) {
    console.warn('Get squad error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch squad' }
    });
  }
}

async function handleDelete(req, res, id, user) {
  try {
    // Check if player is the leader
    const { data: squad } = await getSupabase()
      .from('commander_waitlist_groups')
      .select('leader_id')
      .eq('id', id)
      .maybeSingle();

    if (!squad) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Squad not found' }
      });
    }

    // 2026-07-25 audit fix: compare against the verified user id, never req.body.
    if (String(squad.leader_id) !== String(user.id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only leader can disband squad' }
      });
    }

    // Delete members first
    await getSupabase()
      .from('commander_waitlist_group_members')
      .delete()
      .eq('group_id', id);

    // Delete squad
    await getSupabase()
      .from('commander_waitlist_groups')
      .delete()
      .eq('id', id);

    return res.status(200).json({
      success: true,
      data: { message: 'Squad disbanded' }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Delete squad error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to delete squad' }
    });
  }
}
