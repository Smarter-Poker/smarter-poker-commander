/**
 * Close Day API
 * POST /api/commander/close-day - Persist an end-of-day close (upsert per venue + date)
 * GET  /api/commander/close-day - Recent close records for a venue (history)
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF on EVERY method, reads included.
// 2026-08-20 audit fix: this used guardWriteStaff, which returns `true` for GET
// without verifying anything, so the end-of-day close history - full financial
// report snapshots and totals - was readable by anyone who guessed a venue_id.
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardStaff(req, res); if (!_g) return;

    if (req.method === 'POST') return closeDay(req, res, _g);
    if (req.method === 'GET') return listCloses(req, res, _g);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// 2026-08-20 audit fix: venue_id arrived from the client and was never checked
// against the caller's staff session, so staff at venue A could read or write
// venue B's day closes by changing one parameter.
function venueMismatch(staff, venueId) {
  if (!staff || staff === true) return false;
  if (staff.venue_id === undefined || staff.venue_id === null) return false;
  return String(staff.venue_id) !== String(venueId);
}

async function closeDay(req, res, staff) {
  const { venue_id, closed_by_name, shift_notes, report_snapshot, totals } = req.body || {};

  const venueId = parseInt(venue_id, 10);
  if (!Number.isInteger(venueId)) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id (integer) required' } });
  }

  if (venueMismatch(staff, venueId)) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' } });
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
    try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Close day error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}

async function listCloses(req, res, staff) {
  const { venue_id, date, limit = 30 } = req.query;

  const venueId = parseInt(venue_id, 10);
  if (!Number.isInteger(venueId)) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id (integer) required' } });
  }

  if (venueMismatch(staff, venueId)) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' } });
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
