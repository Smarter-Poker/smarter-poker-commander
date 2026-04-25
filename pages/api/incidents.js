/**
 * Incidents API
 * GET /api/commander/incidents - List incidents
 * POST /api/commander/incidents - Create incident (floor call, dispute, etc)
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

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
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });

      const { data: staff } = await getSupabase()
        .from('commander_staff')
        .select('venue_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (!staff) return res.status(403).json({ success: false, error: 'Staff access required' });

      if (req.method === 'GET') {
        const { status = 'open', limit: rawLimit = '50' } = req.query;
        const limit = Math.min(parseInt(rawLimit) || 50, 500);
        let query = getSupabase()
          .from('commander_incidents')
          .select('*')
          .eq('venue_id', staff.venue_id)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (status !== 'all') query = query.eq('status', status);

        const { data, error } = await query;
        if (error) {
          console.warn('[Incidents] Query error:', error.message);
          return res.status(500).json({ success: false, error: 'Failed to fetch incidents' });
        }
        return res.status(200).json({ success: true, data: data || [] });
      }

      if (req.method === 'POST') {
        const { type, table_number, description, priority = 'normal' } = req.body;

        const { data, error } = await getSupabase()
          .from('commander_incidents')
          .insert({
            venue_id: staff.venue_id,
            type: type || 'floor_call',
            table_number: table_number || null,
            description: description || '',
            priority,
            status: 'open',
            reported_by: user.id,
            created_at: new Date().toISOString()
          })
          .select()
          .maybeSingle();

        if (error) {
          console.warn('Incident create error:', error);
          return res.status(500).json({ success: false, error: 'Internal server error' });
        }
        return res.status(201).json({ success: true, data });
      }

      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Incidents error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
