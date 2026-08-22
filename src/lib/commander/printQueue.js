/**
 * Commander Print Queue
 *
 * Server-side receipt enqueueing. Every receipt-producing action (table break,
 * seat change, buy-in, rebuy, add-on, payout, chip race) writes a job here
 * instead of relying on whichever device performed the action to successfully
 * open a popup window.
 *
 * WHY THIS EXISTS
 * ---------------
 * Receipts used to be printed only by window.open() + window.print() on the
 * acting device, guarded by `if (!pw) return;`. When the popup was blocked, or
 * when the action came from a table tablet (which discards the auto_break
 * payload entirely), the seat moves were already committed and the players got
 * relocated with no card at all. There was also no reprint and no audit trail.
 *
 * With the queue: the server records what is owed, the floor print station
 * claims and prints it, and nothing is lost.
 */

/**
 * Enqueue a print job. Never throws: a printing failure must not roll back the
 * tournament action that produced it. Returns the job row or null.
 *
 * @param {object} supabase  service-role client
 * @param {object} job
 * @param {number} job.venueId
 * @param {string} [job.tournamentId]
 * @param {string} job.jobType      seat_change | table_break | buyin | rebuy | addon | payout | chip_race | custom
 * @param {Array}  job.receipts     array of card payloads
 * @param {string} [job.title]
 * @param {string} [job.source]     which surface triggered it (td_console, table_tablet, auto_break, ...)
 * @param {number} [job.tableNumber]
 * @param {string} [job.createdBy]  staff id
 * @param {object} [job.meta]       extra payload fields
 */
export async function enqueuePrintJob(supabase, job) {
  try {
    const receipts = Array.isArray(job?.receipts) ? job.receipts : [];
    if (!job?.venueId || !job?.jobType || receipts.length === 0) return null;

    const row = {
      venue_id: Number(job.venueId),
      tournament_id: job.tournamentId || null,
      job_type: job.jobType,
      status: 'queued',
      title: job.title || null,
      payload: { receipts, ...(job.meta || {}) },
      receipt_count: receipts.length,
      source: job.source || null,
      table_number: Number.isFinite(Number(job.tableNumber)) ? Number(job.tableNumber) : null,
      created_by: job.createdBy || null
    };

    const { data, error } = await supabase
      .from('commander_print_jobs')
      .insert(row)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[printQueue] enqueue failed', {
        job_type: row.job_type, venue_id: row.venue_id,
        code: error.code, message: error.message, details: error.details
      });
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn('[printQueue] enqueue exception:', err?.message || err);
    return null;
  }
}

/**
 * Convenience wrapper for the seat-change cards produced by a table break.
 * Accepts the `receipts` array the break endpoints already build.
 */
export async function enqueueSeatChangeReceipts(supabase, {
  venueId, tournamentId, receipts, brokenTable, source, createdBy
}) {
  return enqueuePrintJob(supabase, {
    venueId,
    tournamentId,
    jobType: brokenTable ? 'table_break' : 'seat_change',
    receipts,
    title: brokenTable
      ? `Table ${brokenTable} Broken, ${receipts?.length || 0} Seat Change Cards`
      : `${receipts?.length || 0} Seat Change Cards`,
    source: source || 'auto_break',
    tableNumber: brokenTable || null,
    createdBy: createdBy || null,
    meta: { broken_table: brokenTable || null }
  });
}
