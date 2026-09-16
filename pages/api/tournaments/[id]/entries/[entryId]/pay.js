/**
 * Mark A Tournament Payout Paid (And Void A Mis-Click)
 * POST /api/commander/tournaments/[id]/entries/[entryId]/pay
 *
 * WHY THIS EXISTS
 * ---------------
 * Recording a payout and PAYING a payout were the same thing in this system,
 * which meant neither happened properly. payout.js writes payout_amount onto
 * the entry; nothing anywhere wrote payout_status, paid_at or paid_by (verified
 * against production 2026-08-20: 337 entry rows, every one of them NULL on all
 * three), and nothing ever wrote a cash_out row to
 * commander_cash_transactions. So the reconciliation report's ACTUAL OUT was
 * structurally zero, CASH_OUT_VARIANCE was always the full prize pool, and the
 * drawer could never balance no matter how carefully the cage worked.
 *
 * This route is the money-leaves-the-drawer event. It does three things in one
 * call, and it is the ONLY place any of them should happen:
 *
 *   1. Stamps the entry paid    payout_status / paid_at / paid_by
 *   2. Writes the ledger row    commander_cash_transactions type 'cash_out',
 *                               linked to the tournament by tournament_id AND
 *                               carrying the entry id in the notes
 *   3. Refuses to do it twice   idempotency_key derived from the entry
 *
 * PAYOUT_STATUS VOCABULARY (binding)
 * ----------------------------------
 * commander_tournament_entries.payout_status is free text with NO check
 * constraint, and production holds only NULL today (337/337). Rather than leave
 * it open, this route standardises the vocabulary on exactly three values and
 * every reader should assume no others exist:
 *
 *   'paid'    money has physically left the drawer. paid_at + paid_by are set
 *             and a live (non-voided) cash_out row exists for the entry.
 *   'unpaid'  the entry is owed money that has not been handed over. NULL means
 *             the same thing (every legacy row), so treat NULL as 'unpaid'.
 *   'voided'  a payment was made and then reversed. paid_at / paid_by are
 *             cleared and the ledger row carries voided_at. The entry is owed
 *             the money again and will reappear in UNPAID_ITM_FINISHERS.
 *
 * reconciliation.js already accepts 'paid' (PAID_STATUSES) and treats anything
 * else without a paid_at as unpaid, so 'unpaid' and 'voided' need no change
 * there.
 *
 * ENTRY.PAYMENT_METHOD IS DELIBERATELY NOT OVERWRITTEN
 * ----------------------------------------------------
 * commander_tournament_entries.payment_method is the BUY-IN method, written by
 * register.js and read by reports.js to break collected money down by method
 * per cashier. Stamping the payout method onto it would silently destroy the
 * buy-in record for every paid finisher. The payout method is authoritative on
 * the cash_out ledger row (which is what the reconciliation report groups by)
 * and is mirrored into entry metadata.payout_payment_method for display.
 *
 * IDEMPOTENCY
 * -----------
 * Same mechanism the rebuy/add-on RPCs use: a unique partial index on
 * commander_cash_transactions.idempotency_key. The key is derived from the
 * entry so a double-tapped Pay button cannot pay twice even if both requests
 * land in the same millisecond. Re-pay after a void gets attempt :2, :3 ... so
 * the history of a corrected payment is preserved rather than overwritten.
 *
 * Body:
 *   { amount?, payment_method?, notes?, force?: boolean }        pay
 *   { action: 'void', reason? }                                  reverse
 *
 * Auth: STAFF, venue-scoped.
 */
import { createClient } from '../../../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../../src/lib/apiErrorHandler';
import { logAction } from '../../../../../../src/lib/commander/audit';
import { isUniqueViolation } from '../../../../../../src/lib/commander/dbErrors';
import { entryBountyWinnings } from '../../../../../../src/lib/commander/tournamentBounty';
import {
  CASH_TX_PAYMENT_METHODS,
  DEFAULT_PAYMENT_METHOD
} from '../../../../../../src/lib/commander/paymentMethods';
import { isSameVenue } from '../../../../../../src/lib/commander/venueScope';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// The three values payout_status may hold. See the header block.
export const PAYOUT_STATUS_PAID = 'paid';
export const PAYOUT_STATUS_UNPAID = 'unpaid';
export const PAYOUT_STATUS_VOIDED = 'voided';

// commander_cash_transactions.payment_method CHECK. This list used to live
// here; it now comes from the shared vocabulary so it cannot drift from the
// copies register.js and payoutPayments.js carried (both of which had).
// See src/lib/commander/paymentMethods.js for the constraint it mirrors.

/** Rounded to cents, matching numeric(12,2) on both money columns. */
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The idempotency key prefix for one entry's payouts.
 *
 * Every payment attempt for the entry shares this prefix, so the whole history
 * (including voided attempts) can be read back with a single prefix query and
 * the next attempt number derived from it.
 */
function payKeyPrefix(entryId) {
  return `tournament-payout:${entryId}`;
}

/** The name the cage knows this player by, and the ledger stores. */
function entryName(entry) {
  return entry?.profiles?.display_name || entry?.player_name || 'Unknown Player';
}

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const staff = await guardStaff(req, res);
    if (!staff) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
      });
    }

    const { id: tournamentId, entryId } = req.query;
    if (!tournamentId || !entryId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Tournament Id And Entry Id Are Both Required' }
      });
    }

    const loaded = await loadContext(tournamentId, entryId, staff);
    if (loaded.error) {
      return res.status(loaded.status).json({ success: false, error: loaded.error });
    }

    const action = String(req.body?.action || 'pay').toLowerCase();
    if (action === 'void') {
      return voidPayment(req, res, loaded, staff);
    }
    if (action !== 'pay') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: "action Must Be 'pay' Or 'void'" }
      });
    }
    return payEntry(req, res, loaded, staff);

  } catch (err) {
    try { reportApiError(err, req); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    console.warn('[tournament pay] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Internal Server Error' }
      });
    }
  }
}

/**
 * Load the tournament and the entry, venue-scoped.
 * Returns { tournament, entry } or { status, error }.
 */
async function loadContext(tournamentId, entryId, staff) {
  const { data: tournament, error: tErr } = await getSupabase()
    .from('commander_tournaments')
    .select('id, venue_id, name, status')
    .eq('id', tournamentId)
    .maybeSingle();

  if (tErr) {
    console.warn('[tournament pay] tournament read failed:', tErr.message || tErr);
    return { status: 500, error: { code: 'DB_ERROR', message: 'Failed To Read The Tournament' } };
  }
  if (!tournament) {
    return { status: 404, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } };
  }
  // One shared check. This spelling fell OPEN on a null venue_id.
  // 2026-09-03: this helper has no `res` in scope - the old
  // `denyCrossVenue(res, ...)` line threw ReferenceError on EVERY request that
  // reached it (i.e. every request for a tournament that exists), which the
  // handler's catch turned into a 500. Return the refusal as data instead; the
  // handler already knows how to send { status, error }.
  if (!isSameVenue(staff, tournament)) {
    return { status: 403, error: { code: 'WRONG_VENUE', message: 'Tournament Belongs To A Different Venue' } };
  }

  // bounty_winnings arrived in a later migration; fall back so a deploy that
  // lands before it still pays people.
  const columns = `id, tournament_id, player_id, player_name, status, finish_position,
    payout_amount, payout_position, payout_status, paid_at, paid_by, metadata,
    profiles (id, display_name)`;

  let { data: entry, error: eErr } = await getSupabase()
    .from('commander_tournament_entries')
    .select(`${columns}, bounty_winnings`)
    .eq('id', entryId)
    .eq('tournament_id', tournamentId)
    .maybeSingle();

  if (eErr && (eErr.code === '42703' || eErr.code === 'PGRST204' ||
    /column .* does not exist/i.test(String(eErr.message || '')))) {
    ({ data: entry, error: eErr } = await getSupabase()
      .from('commander_tournament_entries')
      .select(columns)
      .eq('id', entryId)
      .eq('tournament_id', tournamentId)
      .maybeSingle());
  }

  if (eErr) {
    console.warn('[tournament pay] entry read failed:', eErr.message || eErr);
    return { status: 500, error: { code: 'DB_ERROR', message: 'Failed To Read The Entry' } };
  }
  if (!entry) {
    return { status: 404, error: { code: 'NOT_FOUND', message: 'Entry Not Found In This Tournament' } };
  }

  return { tournament, entry };
}

/**
 * Every payout ledger row ever written for this entry, newest last.
 * Voided rows are included on purpose: they are what the next attempt number is
 * counted from, and they are the audit trail of a corrected payment.
 */
async function loadPayRows(tournamentId, entryId) {
  const { data, error } = await getSupabase()
    .from('commander_cash_transactions')
    .select('id, type, amount, payment_method, player_name, notes, idempotency_key, created_at, voided_at, void_reason')
    // tournament_id first: it is indexed, and every row this route writes
    // carries it. Without it the LIKE below is a sequential scan of the whole
    // venue ledger on every single payment.
    .eq('tournament_id', tournamentId)
    .like('idempotency_key', `${payKeyPrefix(entryId)}%`)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    console.warn('[tournament pay] payout ledger read failed:', error.message || error);
    return { rows: null, error };
  }
  return { rows: data || [], error: null };
}

/** The one live (non-voided) payout row, if there is one. */
function liveRow(rows) {
  return (rows || []).find(r => !r.voided_at && r.type === 'cash_out') || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAY
// ─────────────────────────────────────────────────────────────────────────────

async function payEntry(req, res, { tournament, entry }, staff) {
  const owed = money(entry.payout_amount);

  // A payout that was never recorded is not a payout. The TD records the money
  // on the payouts screen first; the cage then hands it over here. Paying an
  // unrecorded amount would put cash in the ledger that reconciles against
  // nothing at all.
  if (!(owed > 0)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'NO_PAYOUT_AMOUNT',
        message: `${entryName(entry)} Has No Payout Amount Recorded. Record The Payout On The Payouts Screen First, Then Pay.`
      }
    });
  }

  // amount is optional and defaults to what is owed. When it IS sent it must be
  // a real positive number, and it may never exceed what this entry could
  // legitimately be owed (the recorded payout plus any bounty winnings that are
  // being handed over at the same window). A fat-fingered extra zero is a cash
  // discrepancy nobody finds until the drawer is counted.
  const bounty = money(entryBountyWinnings(entry));
  const ceiling = money(owed + bounty);
  let amount = owed;
  if (req.body?.amount !== undefined && req.body?.amount !== null && req.body?.amount !== '') {
    const requested = money(req.body.amount);
    if (!(requested > 0)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'amount Must Be A Positive Number' }
      });
    }
    if (requested > ceiling) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'AMOUNT_EXCEEDS_OWED',
          message: `${amount.toLocaleString()} Is Recorded For ${entryName(entry)} But ${requested.toLocaleString()} Was Entered. The Most This Entry Can Be Paid Is ${ceiling.toLocaleString()}.`
        }
      });
    }
    amount = requested;
  }

  const rawMethod = req.body?.payment_method;
  let paymentMethod = DEFAULT_PAYMENT_METHOD;
  if (rawMethod !== undefined && rawMethod !== null && rawMethod !== '') {
    if (!CASH_TX_PAYMENT_METHODS.includes(rawMethod)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAYMENT_METHOD',
          message: `payment_method Must Be One Of: ${CASH_TX_PAYMENT_METHODS.join(', ')}`
        }
      });
    }
    paymentMethod = rawMethod;
  }

  const staffNote = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 300) : '';
  const force = req.body?.force === true;

  const { rows, error: rowsErr } = await loadPayRows(tournament.id, entry.id);
  if (rowsErr) {
    return res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: 'Failed To Read The Payout Ledger For This Entry' }
    });
  }

  const existing = liveRow(rows);
  const flaggedPaid = String(entry.payout_status || '').toLowerCase() === PAYOUT_STATUS_PAID || !!entry.paid_at;

  if ((existing || flaggedPaid) && !force) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'ALREADY_PAID',
        message: existing
          ? `${entryName(entry)} Was Already Paid ${money(existing.amount).toLocaleString()}. Void That Payment First, Or Send force To Re-Pay.`
          : `${entryName(entry)} Is Already Marked Paid. Send force To Re-Pay.`
      },
      data: existing ? {
        transaction_id: existing.id,
        amount: money(existing.amount),
        paid_at: entry.paid_at || existing.created_at
      } : undefined
    });
  }

  // Re-pay: the prior row is voided FIRST so the drawer never shows two live
  // payouts for one place, not even for the moment between the two writes.
  let voidedPrior = null;
  if (existing && force) {
    const { data: voided, error: voidErr } = await getSupabase()
      .from('commander_cash_transactions')
      .update({
        voided_at: new Date().toISOString(),
        voided_by: staff.id || null,
        void_reason: `Superseded By A Corrected Payout${staffNote ? `: ${staffNote}` : ''}`
      })
      .eq('id', existing.id)
      .is('voided_at', null)
      .select('id, amount')
      .maybeSingle();

    if (voidErr) {
      console.warn('[tournament pay] failed to void the prior payout row:', voidErr.message || voidErr);
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'The Previous Payment Could Not Be Voided, So Nothing Was Re-Paid.' }
      });
    }
    // Lost the race to another void. The re-pay is still correct: there is now
    // no live row, so fall through and write the new one.
    voidedPrior = voided ? { id: voided.id, amount: money(voided.amount) } : null;
  }

  // Attempt number counts EVERY prior row, live or voided, so a corrected
  // payment never collides with the key of the payment it replaces.
  const attempt = (rows || []).length + 1;
  const idempotencyKey = attempt === 1
    ? payKeyPrefix(entry.id)
    : `${payKeyPrefix(entry.id)}:${attempt}`;

  const playerName = entryName(entry);
  const place = Number(entry.payout_position) || Number(entry.finish_position) || null;
  // The entry id in the notes is what reconciliation.js parses (ENTRY_ID_IN_NOTES)
  // to link a ledger row back to an entry. The format is load-bearing.
  const notes = [
    `Tournament Payout: ${playerName} (ID: ${entry.id})`,
    place ? `Place ${place}` : null,
    tournament.name ? `Event: ${tournament.name}` : null,
    staffNote || null
  ].filter(Boolean).join(' | ');

  const { data: inserted, error: insertErr } = await getSupabase()
    .from('commander_cash_transactions')
    .insert({
      venue_id: tournament.venue_id,
      tournament_id: tournament.id,
      player_name: playerName,
      type: 'cash_out',
      amount,
      payment_method: paymentMethod,
      processed_by: staff.id || null,
      notes,
      idempotency_key: idempotencyKey
    })
    .select('id, amount, payment_method, created_at')
    .maybeSingle();

  let transaction = inserted || null;
  let replayed = false;

  if (insertErr) {
    // Two devices tapped Pay at the same instant. The unique index on
    // idempotency_key means exactly one insert wins; the loser reports the
    // WINNER's row and success, because the money moved exactly once, which is
    // the whole point of the key.
    if (isUniqueViolation(insertErr)) {
      const { data: winner } = await getSupabase()
        .from('commander_cash_transactions')
        .select('id, amount, payment_method, created_at')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (winner) {
        transaction = winner;
        replayed = true;
      } else {
        return res.status(409).json({
          success: false,
          error: { code: 'ALREADY_PAID', message: 'That Payment Was Already Recorded By Another Device.' }
        });
      }
    } else {
      console.error('[tournament pay] cash_out insert failed', {
        tournament_id: tournament.id, entry_id: entry.id, amount,
        code: insertErr.code, message: insertErr.message, details: insertErr.details
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'The Cash Drawer Row Could Not Be Written, So The Entry Was Not Marked Paid.' }
      });
    }
  }

  // Entry flags LAST. If this fails the money row still exists, which is the
  // safe direction: reconciliation reports an unexplained cash_out (loud) rather
  // than a paid entry with no money leaving the drawer (silent).
  const paidAt = transaction?.created_at || new Date().toISOString();
  const metadata = {
    ...(entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}),
    // Deliberately NOT written to entry.payment_method, which holds the BUY-IN
    // method. See the header block.
    payout_payment_method: paymentMethod,
    payout_transaction_id: transaction?.id || null,
    payout_paid_amount: amount,
    payout_attempt: attempt,
    ...(staffNote ? { payout_note: staffNote } : {})
  };

  const { data: updatedEntry, error: entryErr } = await getSupabase()
    .from('commander_tournament_entries')
    .update({
      payout_status: PAYOUT_STATUS_PAID,
      paid_at: paidAt,
      paid_by: staff.id || null,
      metadata
    })
    .eq('id', entry.id)
    .eq('tournament_id', tournament.id)
    .select('id, player_name, payout_amount, payout_status, paid_at, paid_by, finish_position, payout_position')
    .maybeSingle();

  if (entryErr) {
    console.error('[tournament pay] entry paid flags write failed', {
      entry_id: entry.id, transaction_id: transaction?.id,
      code: entryErr.code, message: entryErr.message
    });
    return res.status(500).json({
      success: false,
      error: {
        code: 'PARTIAL_WRITE',
        message: 'The Cash Row Was Recorded But The Entry Could Not Be Marked Paid. Reconcile This Entry Before Closing The Drawer.'
      },
      data: { transaction_id: transaction?.id || null, amount }
    });
  }

  await logAction({ action: 'pay_tournament_payout', category: 'tournament' }, {
    venueId: tournament.venue_id,
    staffId: staff.id,
    targetId: entry.id,
    targetType: 'commander_tournament_entries',
    targetName: playerName,
    metadata: {
      tournament_id: tournament.id,
      entry_id: entry.id,
      player_name: playerName,
      amount,
      payout_amount: owed,
      payment_method: paymentMethod,
      finish_position: place,
      transaction_id: transaction?.id || null,
      attempt,
      replayed,
      forced: force,
      voided_prior_transaction_id: voidedPrior?.id || null
    },
    req
  }).catch(err => console.warn('[tournament pay] audit log failed:', err?.message || err));

  return res.status(200).json({
    success: true,
    data: {
      entry: updatedEntry,
      entry_id: entry.id,
      player_name: playerName,
      amount,
      payout_amount: owed,
      // Non-zero when the cage handed over more or less than the recorded
      // payout. Surfaced so the screen can say so rather than leaving it for
      // the reconciliation report to discover at 3am.
      variance: money(amount - owed),
      payment_method: paymentMethod,
      payout_status: PAYOUT_STATUS_PAID,
      paid_at: paidAt,
      transaction_id: transaction?.id || null,
      attempt,
      replayed,
      voided_prior: voidedPrior,
      message: replayed
        ? `${playerName} Was Already Paid ${amount.toLocaleString()}. Nothing Moved Twice.`
        : `${playerName} Paid ${amount.toLocaleString()}.`
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// VOID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reverse a payment, both sides.
 *
 * The ledger row is marked voided rather than deleted (reconciliation.js
 * excludes `voided_at IS NOT NULL` from both the linked read and the drawer
 * sweep, so voided money correctly stops counting while the row survives for
 * audit), and the entry drops back to 'voided' with paid_at / paid_by cleared,
 * which puts it back on the UNPAID_ITM_FINISHERS list.
 */
async function voidPayment(req, res, { tournament, entry }, staff) {
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
    ? req.body.reason.trim().slice(0, 300)
    : 'Voided By Staff';

  const { rows, error: rowsErr } = await loadPayRows(tournament.id, entry.id);
  if (rowsErr) {
    return res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: 'Failed To Read The Payout Ledger For This Entry' }
    });
  }

  const existing = liveRow(rows);
  const flaggedPaid = String(entry.payout_status || '').toLowerCase() === PAYOUT_STATUS_PAID || !!entry.paid_at;

  if (!existing && !flaggedPaid) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'NOT_PAID',
        message: `${entryName(entry)} Has No Payment To Void.`
      }
    });
  }

  let voidedTransaction = null;
  if (existing) {
    const { data: voided, error: voidErr } = await getSupabase()
      .from('commander_cash_transactions')
      .update({
        voided_at: new Date().toISOString(),
        voided_by: staff.id || null,
        void_reason: reason
      })
      .eq('id', existing.id)
      .is('voided_at', null)
      .select('id, amount, created_at')
      .maybeSingle();

    if (voidErr) {
      console.warn('[tournament pay] void failed:', voidErr.message || voidErr);
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'The Cash Row Could Not Be Voided. The Entry Is Still Marked Paid.' }
      });
    }
    voidedTransaction = voided ? { id: voided.id, amount: money(voided.amount) } : null;
  }

  const metadata = {
    ...(entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}),
    payout_voided_at: new Date().toISOString(),
    payout_void_reason: reason,
    payout_voided_transaction_id: voidedTransaction?.id || existing?.id || null
  };
  delete metadata.payout_transaction_id;
  delete metadata.payout_paid_amount;
  delete metadata.payout_payment_method;

  const { data: updatedEntry, error: entryErr } = await getSupabase()
    .from('commander_tournament_entries')
    .update({
      payout_status: PAYOUT_STATUS_VOIDED,
      paid_at: null,
      paid_by: null,
      metadata
    })
    .eq('id', entry.id)
    .eq('tournament_id', tournament.id)
    .select('id, player_name, payout_amount, payout_status, paid_at, paid_by, finish_position, payout_position')
    .maybeSingle();

  if (entryErr) {
    console.error('[tournament pay] entry void flags write failed', {
      entry_id: entry.id, code: entryErr.code, message: entryErr.message
    });
    return res.status(500).json({
      success: false,
      error: {
        code: 'PARTIAL_WRITE',
        message: 'The Cash Row Was Voided But The Entry Is Still Marked Paid. Reconcile This Entry Before Closing The Drawer.'
      }
    });
  }

  await logAction({ action: 'void_tournament_payout', category: 'tournament' }, {
    venueId: tournament.venue_id,
    staffId: staff.id,
    targetId: entry.id,
    targetType: 'commander_tournament_entries',
    targetName: entryName(entry),
    metadata: {
      tournament_id: tournament.id,
      entry_id: entry.id,
      player_name: entryName(entry),
      amount: voidedTransaction?.amount ?? null,
      reason,
      transaction_id: voidedTransaction?.id || null
    },
    req
  }).catch(err => console.warn('[tournament pay] audit log failed:', err?.message || err));

  return res.status(200).json({
    success: true,
    data: {
      entry: updatedEntry,
      entry_id: entry.id,
      player_name: entryName(entry),
      payout_status: PAYOUT_STATUS_VOIDED,
      voided_transaction: voidedTransaction,
      reason,
      message: voidedTransaction
        ? `Payment Of ${voidedTransaction.amount.toLocaleString()} To ${entryName(entry)} Voided. The Entry Is Owed That Money Again.`
        : `${entryName(entry)} Is No Longer Marked Paid. There Was No Cash Row To Void.`
    }
  });
}
