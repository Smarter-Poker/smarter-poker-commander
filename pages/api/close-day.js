/**
 * Close Day API
 * POST /api/commander/close-day - Persist an end-of-day close (upsert per venue + date)
 * GET  /api/commander/close-day - Recent close records for a venue (history)
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

// Auth: STAFF_WRITE - writes require a signed staff session; GET is venue-scoped history.
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method === 'POST') return closeDay(req, res, _g);
    if (req.method === 'GET') return listCloses(req, res);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function closeDay(req, res, staff) {
  const { venue_id, closed_by_name, shift_notes, report_snapshot, totals } = req.body || {};

  const venueId = parseInt(venue_id, 10);
  if (!Number.isInteger(venueId)) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id (integer) required' } });
  }

  try {
    // closed_by comes from the authenticated staff session, not the client -
    // PIN terminals carry the commander_staff row id, owner logins the user id.
    const staffId = (staff && typeof staff === 'object' && staff.id) ? staff.id : null;

    const { data: close, error } = await getSupabase()
      .from('commander_day_closes')
      .upsert({
        venue_id: venueId,
        close_date: new Date().toISOString().split('T')[0],
        closed_by: staffId,
        closed_by_name: closed_by_name || (staff && staff.display_name) || null,
        report_snapshot: report_snapshot || {},
        shift_notes: shift_notes || null,
        totals: totals || {},
      }, { onConflict: 'venue_id,close_date' })
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ success: true, data: { close } });
  } catch (error) {
    try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Close day error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}

async function listCloses(req, res) {
  const { venue_id, date, limit = 30 } = req.query;

  const venueId = parseInt(venue_id, 10);
  if (!Number.isInteger(venueId)) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id (integer) required' } });
  }

  try {
    let query = getSupabase()
      .from('commander_day_closes')
      .select('*')
      .eq('venue_id', venueId)
      .order('close_date', { ascending: false })
      .limit(Math.min(parseInt(limit) || 30, 365));

    if (date) query = query.eq('close_date', date);

    const { data: closes, error } = await query;
    if (error) throw error;

    return res.status(200).json({ success: true, data: { closes: closes || [] } });
  } catch (error) {
    console.warn('List closes error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}
