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
      const { data: currentMember } = await getSupabase()
        .from('commander_members')
        .select('visit_count')
        .eq('id', member_id)
        .maybeSingle();

      const { data: member, error: memberError } = await getSupabase()
        .from('commander_members')
        .update({
          last_checkin: new Date().toISOString(),
          visit_count: (currentMember?.visit_count || 0) + 1
        })
        .eq('id', member_id)
        .select()
        .maybeSingle();

      // Also log the check-in event
      await getSupabase().from('commander_checkins').insert({
        member_id,
        venue_id: member?.venue_id,
        checked_in_at: new Date().toISOString()
      }).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); // Non-fatal if table doesn't exist

      return res.status(200).json({
        success: true,
        data: {
          member_id,
          checked_in_at: new Date().toISOString(),
          member_name: member?.name || `${member?.first_name} ${member?.last_name}`
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
