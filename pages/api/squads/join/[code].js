/**
 * Squad Invite Link API
 * GET  /api/commander/squads/join/:code - Look up a squad by invite code
 * POST /api/commander/squads/join/:code - Join the squad as the verified user
 *
 * 2026-07-25 audit fix: invite links (/hub/commander/squads/join/CODE) had no
 * backing endpoint — the WH page mistakenly called the home-games join route.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
import { checkMemoryRateLimit } from '../../../../src/lib/commander/rateLimit';
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

const CLOSED_STATUSES = ['disbanded', 'closed'];

async function findSquadByCode(code) {
  // invite_code is stored uppercase; match case-insensitively.
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;

  const { data: squad, error } = await getSupabase()
    .from('commander_waitlist_groups')
    .select('id, name, game_type, stakes, venue_id, max_size, is_private, invite_code, group_status, leader_id')
    .ilike('invite_code', normalized)
    .maybeSingle();

  if (error) {
    console.warn('Squad invite lookup error:', error);
    return null;
  }
  return squad || null;
}

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Rate-limit code lookups by IP (invite codes are guessable strings).
    const fwd = req.headers['x-forwarded-for'];
    const ip = fwd ? String(fwd).split(',')[0].trim() : req.socket?.remoteAddress || '0';
    const rl = checkMemoryRateLimit(`squad-invite:${ip}`, 20, 60000);
    if (!rl.allowed) {
      return res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' }
      });
    }

    const { code } = req.query;

    if (req.method === 'GET') {
      return handleLookup(req, res, code);
    } else if (req.method === 'POST') {
      return handleJoin(req, res, code);
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

async function handleLookup(req, res, code) {
  try {
    const squad = await findSquadByCode(code);

    if (!squad || CLOSED_STATUSES.includes(squad.group_status)) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Invite link is invalid or expired' }
      });
    }

    const { count: memberCount } = await getSupabase()
      .from('commander_waitlist_group_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', squad.id);

    return res.status(200).json({
      success: true,
      data: {
        squad: {
          id: squad.id,
          name: squad.name,
          game_type: squad.game_type,
          stakes: squad.stakes,
          venue_id: squad.venue_id,
          max_size: squad.max_size,
          member_count: memberCount || 0,
          group_status: squad.group_status
        }
      }
    });
  } catch (error) {
    console.warn('Squad invite lookup error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to look up invite' }
    });
  }
}

async function handleJoin(req, res, code) {
  // Identity comes from the verified session user, never the request body.
  const user = await guardUser(req, res);
  if (!user) return;

  try {
    const squad = await findSquadByCode(code);

    if (!squad || CLOSED_STATUSES.includes(squad.group_status)) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Invite link is invalid or expired' }
      });
    }

    const { data: members, error: membersError } = await getSupabase()
      .from('commander_waitlist_group_members')
      .select('id, player_id, member_status')
      .eq('group_id', squad.id);

    if (membersError) throw membersError;

    const existing = (members || []).find(m => String(m.player_id) === String(user.id));
    if (existing) {
      // An invited player following the link accepts the invitation.
      if (existing.member_status === 'invited') {
        const { error: acceptError } = await getSupabase()
          .from('commander_waitlist_group_members')
          .update({ member_status: 'active' })
          .eq('id', existing.id);
        if (acceptError) throw acceptError;
        return res.status(200).json({ success: true, data: { squad_id: squad.id } });
      }
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_MEMBER', message: 'Already in this squad' }
      });
    }

    // Capacity check vs max_size
    const activeCount = (members || []).filter(
      m => !['removed', 'declined', 'left'].includes(m.member_status)
    ).length;
    if (squad.max_size && activeCount >= squad.max_size) {
      return res.status(400).json({
        success: false,
        error: { code: 'SQUAD_FULL', message: 'Squad is full' }
      });
    }

    const { error: insertError } = await getSupabase()
      .from('commander_waitlist_group_members')
      .insert({
        group_id: squad.id,
        player_id: user.id,
        member_status: 'active'
      });

    if (insertError) throw insertError;

    return res.status(200).json({
      success: true,
      data: { squad_id: squad.id }
    });
  } catch (error) {
    try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Squad invite join error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to join squad' }
    });
  }
}
