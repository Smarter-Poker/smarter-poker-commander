/**
 * Member Check-In API
 * POST /api/commander/members/checkin
 * Records a member check-in with timestamp
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
      const { member_id } = req.body;
      if (!member_id) return res.status(400).json({ success: false, error: 'member_id required' });

      // Increment visit count (two-step since getSupabase().raw() is not supported in JS v2)
      // 2026-07-28 audit fix: commander_members has total_visits/last_visit —
      // visit_count/last_checkin do not exist, so every check-in silently wrote
      // nothing (PostgREST rejected the update and the error was discarded).
      const nowIso = new Date().toISOString();
      const { data: currentMember, error: readError } = await getSupabase()
        .from('commander_members')
        .select('total_visits')
        .eq('id', member_id)
        .maybeSingle();

      if (readError) {
        console.error('[members/checkin] read commander_members.total_visits failed', {
          member_id, code: readError.code, message: readError.message, details: readError.details,
        });
        throw readError;
      }

      const { data: member, error: memberError } = await getSupabase()
        .from('commander_members')
        .update({
          last_visit: nowIso,
          total_visits: (currentMember?.total_visits || 0) + 1,
          updated_at: nowIso
        })
        .eq('id', member_id)
        .select()
        .maybeSingle();

      if (memberError) {
        console.error('[members/checkin] update commander_members failed', {
          member_id, code: memberError.code, message: memberError.message, details: memberError.details,
        });
      }

      // 2026-07-25 audit fix: if the update matched no row the member doesn't exist —
      // previously fell through and returned member_name 'undefined undefined'.
      if (memberError || !member) {
        return res.status(404).json({ success: false, error: 'Member not found' });
      }

      // Also log the check-in event
      await getSupabase().from('commander_checkins').insert({
        member_id,
        venue_id: member.venue_id,
        checked_in_at: new Date().toISOString()
      }).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); // Non-fatal if table doesn't exist

      // 2026-07-25 audit fix: commander_members has first_name/last_name, not name
      const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member';

      return res.status(200).json({
        success: true,
        data: {
          member_id,
          checked_in_at: new Date().toISOString(),
          member_name: memberName
        }
      });
    } catch (err) {
      console.warn('Check-in error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
