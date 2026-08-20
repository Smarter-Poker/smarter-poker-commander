/**
 * Incidents API
 * GET /api/commander/incidents - List incidents
 * POST /api/commander/incidents - Create incident (floor call, dispute, etc)
 */
// 2026-07-25 audit fix: rewritten to match the real commander_incidents schema
// (incident_type/severity/players_involved/incident_status - the old code wrote
// nonexistent type/priority/status/table_number columns) and to authenticate
// via verifyStaffSession so PIN-terminal staff are not locked out by the
// Bearer-JWT-only path. Response shape now { success, data: { incidents } }.
import { createClient } from '../../src/lib/supabaseServerClient';
import { verifyStaffSession } from '../../src/lib/commander/auth';
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

// Auth: STAFF - verified staff session (PIN terminal or owner login)
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // 2026-07-25 audit fix: staff-session auth for reads AND writes; identity
    // and venue scope come from the verified session, never the request body.
    const sessionResult = await verifyStaffSession(req);
    if (sessionResult.error) {
      return res.status(sessionResult.error.status || 401).json({ success: false, error: sessionResult.error });
    }
    const staff = sessionResult.staff;

    try {
      if (req.method === 'GET') {
        const { status = 'all', limit: rawLimit = '50' } = req.query;
        const limit = Math.min(parseInt(rawLimit) || 50, 500);
        let query = getSupabase()
          .from('commander_incidents')
          .select('*')
          .eq('venue_id', staff.venue_id)
          .order('created_at', { ascending: false })
          .limit(limit);

        // 2026-07-25 audit fix: real column is incident_status, not status
        if (status !== 'all') query = query.eq('incident_status', status);

        const { data, error } = await query;
        if (error) {
          console.warn('[Incidents] Query error:', error.message);
          return res.status(500).json({ success: false, error: 'Failed to fetch incidents' });
        }

        // 2026-07-25 audit fix: derive the convenience fields the page renders
        // (resolved boolean, resolution text) from the real columns.
        const incidents = (data || []).map((row) => ({
          ...row,
          resolved: row.incident_status === 'resolved',
          resolution: row.resolution_notes || null,
        }));

        return res.status(200).json({ success: true, data: { incidents } });
      }

      if (req.method === 'POST') {
        // 2026-07-25 audit fix: read the fields the page actually sends and
        // insert into the real columns. table_number has no dedicated column
        // (table_id is a table reference, not a number) so it is recorded in
        // the description. venue_id/reported_by come from the session.
        const { incident_type, severity = 'medium', players_involved, table_number, description } = req.body || {};

        if (!description) {
          return res.status(400).json({ success: false, error: 'Description is required' });
        }

        const fullDescription = table_number
          ? `[Table ${String(table_number).slice(0, 20)}] ${description}`
          : description;

        const { data, error } = await getSupabase()
          .from('commander_incidents')
          .insert({
            venue_id: staff.venue_id,
            incident_type: incident_type || 'other',
            severity,
            players_involved: Array.isArray(players_involved) ? players_involved : [],
            description: fullDescription,
            incident_status: 'open',
            reported_by: staff.id,
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
