/**
 * Squads API - Create group waitlist
 * POST /api/commander/squads
 * GET /api/commander/squads
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../src/lib/commander/auth';
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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    // Auth guard: require user auth for writes
    if (req.method === 'POST') {
      // 2026-07-25 audit fix: pass the verified user through so the leader is
      // derived from the session, not the request body.
      const user = await guardUser(req, res);
      if (!user) return;
      return handleCreate(req, res, user);
    } else if (req.method === 'GET') {
      return handleList(req, res);
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

async function handleCreate(req, res, user) {
  // 2026-07-25 audit fix: leader is the verified session user — body leader_id
  // is ignored (it was forgeable). Also accept optional name and member_ids
  // from the create-squad wizard.
  const { venue_id, game_type, stakes, name, member_ids } = req.body || {};
  const leader_id = user.id;

  if (!venue_id || !game_type) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'venue_id and game_type required' }
    });
  }

  try {
    // Create squad (waitlist group)
    // 2026-07-25 audit fix: write real columns — group_status (not status);
    // prefer_same_table/accept_split do not exist on commander_waitlist_groups.
    const { data: squad, error } = await getSupabase()
      .from('commander_waitlist_groups')
      .insert({
        venue_id,
        game_type,
        stakes,
        leader_id,
        name: name || null,
        group_status: 'waiting',
        // 2026-07-25 audit fix: generate the invite code at creation — the
        // join-by-code flow depends on it and nothing else populates it.
        invite_code: require('crypto').randomBytes(4).toString('hex').toUpperCase().slice(0, 6)
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    // Add leader as first member
    await getSupabase()
      .from('commander_waitlist_group_members')
      .insert({
        group_id: squad.id,
        player_id: leader_id,
        is_leader: true,
        member_status: 'active'
      });

    // 2026-07-25 audit fix: insert invited members from the wizard (best-effort).
    if (Array.isArray(member_ids) && member_ids.length > 0) {
      const inviteRows = [...new Set(member_ids.map(String))]
        .filter(pid => pid && pid !== String(leader_id))
        .map(pid => ({
          group_id: squad.id,
          player_id: pid,
          is_leader: false,
          member_status: 'invited'
        }));
      if (inviteRows.length > 0) {
        const { error: inviteError } = await getSupabase()
          .from('commander_waitlist_group_members')
          .insert(inviteRows);
        if (inviteError) {
          console.warn('Create squad: failed to insert invited members:', inviteError);
        }
      }
    }

    return res.status(201).json({
      success: true,
      data: { squad }
    });
  } catch (error) {
    console.warn('Create squad error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create squad' }
    });
  }
}

async function handleList(req, res) {
  const { venue_id, player_id, status } = req.query;

  try {
    let query = getSupabase()
      .from('commander_waitlist_groups')
      .select('*')
      .order('created_at', { ascending: false })
          .limit(100);

    if (venue_id) query = query.eq('venue_id', venue_id);
    // 2026-07-25 audit fix: real column is group_status.
    if (status) query = query.eq('group_status', status);

    const { data: squads, error } = await query;

    if (error) throw error;

    // 2026-07-29 wiring fix: commander_waitlist_group_members has no FK to
    // commander_waitlist_groups, so members cannot be PostgREST-embedded off the
    // group (errors PGRST200). Fetch them separately and attach. The nested
    // profiles embed off members IS valid (player_id -> profiles FK exists).
    const squadIds = (squads || []).map(s => s.id);
    const membersByGroup = {};
    if (squadIds.length > 0) {
      const { data: members } = await getSupabase()
        .from('commander_waitlist_group_members')
        .select('id, group_id, player_id, joined_at, profiles:player_id (id, display_name, avatar_url)')
        .in('group_id', squadIds);
      (members || []).forEach(m => {
        (membersByGroup[m.group_id] = membersByGroup[m.group_id] || []).push(m);
      });
    }
    const enriched = (squads || []).map(s => ({
      ...s,
      commander_waitlist_group_members: membersByGroup[s.id] || []
    }));

    // Filter by player if specified
    let filtered = enriched;
    if (player_id) {
      filtered = enriched.filter(s =>
        s.commander_waitlist_group_members?.some(m => m.player_id === player_id)
      );
    }

    return res.status(200).json({
      success: true,
      data: { squads: filtered }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('List squads error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch squads' }
    });
  }
}
