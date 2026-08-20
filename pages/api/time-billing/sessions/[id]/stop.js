/**
 * Stop Time Billing Session
 * POST /api/commander/time-billing/sessions/[id]/stop
 * Ends session, calculates total charge based on duration and rate
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });

      const { id } = req.query;

      const { data: session } = await getSupabase()
        .from('commander_table_sessions')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

      // 2026-08-20 audit fix: the session id was acted on with no venue
      // ownership check, so staff at venue A could close out (and set the
      // total_charge on) venue B's table sessions.
      if (_g && _g !== true && _g.venue_id !== undefined && _g.venue_id !== null
          && String(_g.venue_id) !== String(session.venue_id)) {
        return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
      }

      if (session.status !== 'active') return res.status(400).json({ success: false, error: 'Session not active' });

      const endedAt = new Date();
      const hours = (endedAt - new Date(session.started_at)) / 3600000;
      const halfHours = Math.ceil(hours * 2);
      const totalCharge = (halfHours / 2) * session.rate_per_hour;

      const { data: updated, error } = await getSupabase()
        .from('commander_table_sessions')
        .update({
          status: 'completed',
          ended_at: endedAt.toISOString(),
          total_charge: Math.round(totalCharge * 100) / 100,
          duration_minutes: Math.round(hours * 60),
          ended_by: user.id
        })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
      if (!updated) return res.status(404).json({ success: false, error: 'Session not found' });
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      console.warn('Stop session error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
