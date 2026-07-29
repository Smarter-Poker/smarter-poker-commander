/**
 * Submit Squad to Waitlist API
 * POST /api/commander/squads/:id/submit
 * Submits the entire squad to the venue waitlist
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

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { id } = req.query;

    try {
      // Get authenticated user via Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' }
        });
      }

      // Get squad with members
      // 2026-07-29 wiring fix: commander_waitlist_group_members has no FK to
      // commander_waitlist_groups, so members cannot be embedded off the group
      // (errors PGRST200). Fetch the group, then members (the nested profiles
      // embed off members is valid: player_id -> profiles FK), separately.
      const { data: squad, error: squadError } = await getSupabase()
        .from('commander_waitlist_groups')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (squadError || !squad) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Squad not found' }
        });
      }

      const { data: squadMembers } = await getSupabase()
        .from('commander_waitlist_group_members')
        .select('id, player_id, member_status, joined_at, profiles (id, display_name, phone)')
        .eq('group_id', id);
      squad.commander_waitlist_group_members = squadMembers || [];

      // Verify user is the leader
      if (squad.leader_id !== user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only squad leader can submit to waitlist' }
        });
      }

      // Verify squad is in forming status (not yet submitted)
      // 2026-07-25 audit fix: real column is group_status — squad.status was
      // always undefined, so every submit 400'd as ALREADY_SUBMITTED.
      if (squad.group_status !== 'forming') {
        return res.status(400).json({
          success: false,
          error: { code: 'ALREADY_SUBMITTED', message: 'Squad already submitted to waitlist' }
        });
      }

      // 2026-07-25 audit fix: members DO have member_status — only submit
      // accepted members, not pending invitations.
      const members = (squad.commander_waitlist_group_members || [])
        .filter(m => !m.member_status || m.member_status === 'active');

      if (members.length < 2) {
        return res.status(400).json({
          success: false,
          error: { code: 'NOT_ENOUGH_MEMBERS', message: 'Need at least 2 members' }
        });
      }

      // Get current waitlist position
      const { count: currentPosition } = await getSupabase()
        .from('commander_waitlist')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', squad.venue_id)
        .eq('game_type', squad.game_type)
        .eq('stakes', squad.stakes)
        .eq('status', 'waiting')
            .limit(100);

      const position = (currentPosition || 0) + 1;

      // Build squad notes with preferences
      const squadNotes = [
        `Squad group: ${squad.id}`,
        squad.prefer_same_table ? 'Prefer same table' : null,
        squad.accept_split ? 'Accept split' : null
      ].filter(Boolean).join('. ');

      // Create waitlist entries for each member
      const waitlistEntries = members.map((member, index) => ({
        venue_id: squad.venue_id,
        player_id: member.player_id,
        player_name: member.profiles?.display_name || `Player ${index + 1}`,
        player_phone: member.profiles?.phone || null,
        game_type: squad.game_type,
        stakes: squad.stakes,
        position: position,
        status: 'waiting',
        signup_method: 'app',
        notes: squadNotes
      }));

      const { data: entries, error: entriesError } = await getSupabase()
        .from('commander_waitlist')
        .insert(waitlistEntries)
        .select();

      if (entriesError) throw entriesError;

      // Update squad status to waiting (submitted to waitlist)
      // 2026-07-25 audit fix: real column is group_status; also record
      // submitted_at and position (columns exist on the table).
      const { error: updateError } = await getSupabase()
        .from('commander_waitlist_groups')
        .update({
          group_status: 'waiting',
          submitted_at: new Date().toISOString(),
          position: position
        })
        .eq('id', id);

      if (updateError) throw updateError;

      return res.status(200).json({
        success: true,
        data: {
          message: 'Squad joined waitlist',
          position: position,
          entries_created: entries?.length || 0
        }
      });
    } catch (error) {
      console.warn('Submit squad error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to submit squad to waitlist' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
