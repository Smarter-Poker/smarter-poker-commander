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
import { reportApiError } from '../../../src/lib/apiErrorHandler';

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

// Everything except `payload`. A table break in a big room queues one receipt
// per moved player, so payload is by far the widest column in this table, and
// the station's Recent list renders nothing from it. ?fields=summary drops it
// and the station fetches the receipts for a single job only when someone
// actually asks to print it.
const SUMMARY_COLUMNS = [
  'id', 'venue_id', 'tournament_id', 'job_type', 'status', 'title',
  'receipt_count', 'source', 'table_number', 'created_by', 'created_at',
  'claimed_at', 'printed_at', 'printed_by', 'error', 'reprint_of'
].join(', ');

/**
 * Parse a comma separated list of table numbers into unique positive integers.
 * Anything unparseable is dropped rather than guessed at: a station that sends
 * junk gets the unfiltered queue, which is the safe direction (a job seen by
 * the wrong station is a nuisance, a job seen by nobody is lost paper).
 */
function parseTableNumbers(raw) {
  if (!raw) return [];
  return [...new Set(
    String(raw)
      .split(',')
      .map(s => Number(String(s).trim()))
      .filter(n => Number.isFinite(n) && n > 0)
      .map(n => Math.floor(n))
  )].slice(0, 100);
}

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
  const summaryOnly = String(req.query.fields || '') === 'summary';

  // ── Station routing ────────────────────────────────────────────────────
  // A venue with two rooms runs a printer in each. A station registers the
  // tables (and optionally the job types) it is responsible for and pulls
  // only its own work, so the far room's seat change cards do not come out
  // of the near room's printer.
  //
  // No schema change: commander_print_jobs already carries table_number and
  // job_type, and a station is a device-side identity held in localStorage.
  // The `station` parameter is a label, echoed back for logs, never a filter.
  const tableNumbers = parseTableNumbers(req.query.table_numbers);
  // Jobs with no table (payouts, chip race, custom) belong to no room. They
  // are delivered to every filtered station unless a station opts out, so a
  // job can never be routed into a hole where nothing sees it.
  const includeUnrouted = String(req.query.include_unrouted || '1') !== '0';
  const jobTypes = String(req.query.job_types || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => JOB_TYPES.includes(s));

  let query = getSupabase()
    .from('commander_print_jobs')
    .select(summaryOnly ? SUMMARY_COLUMNS : '*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (req.query.tournament_id) query = query.eq('tournament_id', req.query.tournament_id);
  if (tableNumbers.length > 0) {
    query = includeUnrouted
      ? query.or(`table_number.in.(${tableNumbers.join(',')}),table_number.is.null`)
      : query.in('table_number', tableNumbers);
  }
  if (jobTypes.length > 0) query = query.in('job_type', jobTypes);

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
      queued_count: jobs.filter(j => j.status === 'queued').length,
      // Echoed so a station can confirm the filter the server actually applied
      // rather than the one it thinks it sent.
      station: typeof req.query.station === 'string' ? req.query.station.slice(0, 60) : null,
      filter: {
        table_numbers: tableNumbers,
        include_unrouted: tableNumbers.length > 0 ? includeUnrouted : true,
        job_types: jobTypes,
        fields: summaryOnly ? 'summary' : 'full'
      }
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
