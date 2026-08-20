/**
 * Print Job Queue API
 * GET  /api/commander/print-jobs?venue_id=&status=queued&limit=
 *      Floor print station polls (and realtime-subscribes to) this.
 * POST /api/commander/print-jobs
 *      Manually enqueue a job (reprint from a TD screen, custom card).
 *
 * WHY: receipts used to depend on the acting device opening a popup. A blocked
 * popup, or an action taken on a table tablet, meant players were moved with no
 * seat-change card printed and no record that one was owed.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

const JOB_TYPES = ['seat_change', 'table_break', 'buyin', 'rebuy', 'addon', 'payout', 'chip_race', 'custom'];
const STATUSES = ['queued', 'printing', 'printed', 'voided'];

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else if (!applyRateLimit(req, res, LIMITS.read)) return;

    const staff = await guardStaff(req, res);
    if (!staff) return;

    if (req.method === 'GET') return listJobs(req, res, staff);
    if (req.method === 'POST') return createJob(req, res, staff);

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[print-jobs] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Internal Server Error' }
      });
    }
  }
}

async function listJobs(req, res, staff) {
  // Venue always comes from the verified staff session, never the query string,
  // so one venue's print queue can never be read by another venue's staff.
  const venueId = Number(staff.venue_id) || Number(req.query.venue_id);
  if (!venueId) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Venue Could Not Be Resolved For This Session' }
    });
  }
  if (staff.venue_id && Number(req.query.venue_id) && Number(req.query.venue_id) !== Number(staff.venue_id)) {
    return res.status(403).json({
      success: false,
      error: { code: 'WRONG_VENUE', message: 'Print Queue Belongs To A Different Venue' }
    });
  }

  const status = req.query.status && STATUSES.includes(req.query.status) ? req.query.status : null;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  let query = getSupabase()
    .from('commander_print_jobs')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (req.query.tournament_id) query = query.eq('tournament_id', req.query.tournament_id);

  const { data, error } = await query;
  if (error) {
    console.error('[print-jobs] list failed', { venueId, code: error.code, message: error.message });
    return res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: 'Failed To Read The Print Queue' }
    });
  }

  const jobs = data || [];
  return res.status(200).json({
    success: true,
    data: {
      jobs,
      queued_count: jobs.filter(j => j.status === 'queued').length
    }
  });
}

async function createJob(req, res, staff) {
  const { tournament_id, job_type, receipts, title, source, table_number } = req.body || {};

  if (!job_type || !JOB_TYPES.includes(job_type)) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: `job_type Must Be One Of: ${JOB_TYPES.join(', ')}` }
    });
  }
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'At Least One Receipt Is Required' }
    });
  }
  if (receipts.length > 500) {
    return res.status(400).json({
      success: false,
      error: { code: 'TOO_MANY_RECEIPTS', message: 'A Single Job Cannot Hold More Than 500 Receipts' }
    });
  }

  const venueId = Number(staff.venue_id) || Number(req.body?.venue_id);
  if (!venueId) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Venue Could Not Be Resolved For This Session' }
    });
  }

  // A tournament_id must belong to this venue, otherwise a job could be filed
  // against another room's event.
  if (tournament_id) {
    const { data: t } = await getSupabase()
      .from('commander_tournaments')
      .select('id, venue_id')
      .eq('id', tournament_id)
      .maybeSingle();
    if (!t || Number(t.venue_id) !== venueId) {
      return res.status(403).json({
        success: false,
        error: { code: 'WRONG_VENUE', message: 'Tournament Belongs To A Different Venue' }
      });
    }
  }

  const { data, error } = await getSupabase()
    .from('commander_print_jobs')
    .insert({
      venue_id: venueId,
      tournament_id: tournament_id || null,
      job_type,
      status: 'queued',
      title: typeof title === 'string' ? title.slice(0, 200) : null,
      payload: { receipts },
      receipt_count: receipts.length,
      source: typeof source === 'string' ? source.slice(0, 60) : 'manual',
      table_number: Number.isFinite(Number(table_number)) ? Number(table_number) : null,
      created_by: staff.id || null
    })
    .select()
    .maybeSingle();

  if (error) {
    console.error('[print-jobs] create failed', { venueId, code: error.code, message: error.message });
    return res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: 'Failed To Queue The Print Job' }
    });
  }

  return res.status(201).json({
    success: true,
    data: { job: data, message: `${receipts.length} Receipt(s) Queued For Printing.` }
  });
}
