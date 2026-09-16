/**
 * Print Job Actions API
 * POST /api/commander/print-jobs/[id]
 *   body { action: 'claim' | 'printed' | 'void' | 'requeue' | 'reprint' }
 *
 * claim   -> queued  -> printing   (station took it, stops a second station
 *                                   grabbing the same job)
 * printed -> printing -> printed   (paper is out, floor can collect it)
 * void    -> any      -> voided    (not needed after all)
 * requeue -> any      -> queued    (station failed to print, try again)
 * reprint -> creates a NEW queued job copying this one's receipts
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

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
      });
    }
    if (!applyRateLimit(req, res, req.method === 'GET' ? LIMITS.read : LIMITS.write)) return;
    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { id } = req.query;

    // GET returns one job WITH its receipts. The station's list views pull
    // summaries (?fields=summary) because the payload is the widest column in
    // the table and no list renders it, so this is where the receipts for the
    // one job being printed come from.
    if (req.method === 'GET') {
      const { data: one } = await getSupabase()
        .from('commander_print_jobs')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!one) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Print Job Not Found' }
        });
      }
      if (staff.venue_id && Number(staff.venue_id) !== Number(one.venue_id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'WRONG_VENUE', message: 'Print Job Belongs To A Different Venue' }
        });
      }
      return res.status(200).json({ success: true, data: { job: one } });
    }

    const action = req.body?.action;
    const VALID = ['claim', 'printed', 'void', 'requeue', 'reprint'];
    if (!VALID.includes(action)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `action Must Be One Of: ${VALID.join(', ')}` }
      });
    }

    const { data: job } = await getSupabase()
      .from('commander_print_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Print Job Not Found' }
      });
    }
    if (staff.venue_id && Number(staff.venue_id) !== Number(job.venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'WRONG_VENUE', message: 'Print Job Belongs To A Different Venue' }
      });
    }

    if (action === 'reprint') {
      const receipts = Array.isArray(job.payload?.receipts) ? job.payload.receipts : [];
      if (receipts.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'NOTHING_TO_REPRINT', message: 'This Job Has No Receipts To Reprint' }
        });
      }
      const { data: copy, error: copyErr } = await getSupabase()
        .from('commander_print_jobs')
        .insert({
          venue_id: job.venue_id,
          tournament_id: job.tournament_id,
          job_type: job.job_type,
          status: 'queued',
          title: job.title ? `Reprint, ${job.title}` : 'Reprint',
          payload: job.payload,
          receipt_count: receipts.length,
          source: 'reprint',
          table_number: job.table_number,
          created_by: staff.id || null,
          reprint_of: job.id
        })
        .select()
        .maybeSingle();
      if (copyErr) throw copyErr;
      return res.status(201).json({
        success: true,
        data: { job: copy, message: `${receipts.length} Receipt(s) Queued For Reprint.` }
      });
    }

    // Conditional transitions so two print stations cannot both claim a job.
    let updates = {};
    let expectedStatuses = null;
    if (action === 'claim') {
      updates = { status: 'printing', claimed_at: new Date().toISOString() };
      expectedStatuses = ['queued'];
    } else if (action === 'printed') {
      updates = { status: 'printed', printed_at: new Date().toISOString(), printed_by: staff.id || null };
      expectedStatuses = ['queued', 'printing'];
    } else if (action === 'void') {
      updates = { status: 'voided' };
      expectedStatuses = ['queued', 'printing'];
    } else if (action === 'requeue') {
      updates = { status: 'queued', claimed_at: null, error: req.body?.error ? String(req.body.error).slice(0, 300) : null };
      expectedStatuses = ['queued', 'printing', 'printed', 'voided'];
    }

    const { data: updated, error } = await getSupabase()
      .from('commander_print_jobs')
      .update(updates)
      .eq('id', id)
      .in('status', expectedStatuses)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'STATE_CONFLICT',
          message: `Job Is Already ${String(job.status).replace(/^./, c => c.toUpperCase())} And Cannot Be Changed By This Action`
        }
      });
    }

    return res.status(200).json({ success: true, data: { job: updated } });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[print-jobs/[id]] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed To Update The Print Job' }
      });
    }
  }
}
