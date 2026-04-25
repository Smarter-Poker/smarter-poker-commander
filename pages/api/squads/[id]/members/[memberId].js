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


    const _u = await guardUser(req, res); if (!_u) return;
    const { id, memberId } = req.query;

    if (req.method === 'DELETE') {
      // Only squad owner can remove members
      const { data: squad } = await getSupabase()
        .from('commander_waitlist_groups')
        .select('leader_id')
        .eq('id', id)
        .maybeSingle();

      if (!squad || squad.leader_id !== _u.id) {
        return res.status(403).json({ success: false, error: 'Only squad leader can remove members' });
      }

      const { error } = await getSupabase()
        .from('commander_waitlist_group_members')
        .delete()
        .eq('group_id', id)
        .eq('id', memberId);

      if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
      return res.json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
