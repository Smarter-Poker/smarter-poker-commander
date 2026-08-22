/**
 * Payout Payment Helpers (Client Side)
 *
 * One vocabulary and one set of API calls for "the cage handed this player
 * their money", shared by the TD Results screen and the TD Payouts screen so
 * the two can never disagree about who has been paid.
 *
 * The server side lives at
 *   pages/api/tournaments/[id]/entries/[entryId]/pay.js
 * which is the ONLY writer of payout_status / paid_at / paid_by and the only
 * thing that creates a 'cash_out' row in commander_cash_transactions.
 *
 * PAYOUT_STATUS VOCABULARY (must match pay.js)
 *   'paid'    money left the drawer, paid_at + paid_by set, live cash_out row.
 *   'unpaid'  owed but not handed over. NULL means the same thing.
 *   'voided'  paid then reversed. Owed again.
 */
import { commanderFetch } from './commanderFetch';
import {
  CASH_TX_PAYMENT_METHOD_OPTIONS,
  DEFAULT_PAYMENT_METHOD
} from './paymentMethods';

export const PAYOUT_STATUS_PAID = 'paid';
export const PAYOUT_STATUS_UNPAID = 'unpaid';
export const PAYOUT_STATUS_VOIDED = 'voided';

/**
 * Methods commander_cash_transactions.payment_method accepts, in the order a
 * cage window actually uses them.
 *
 * Re-exported rather than re-declared. The literal that used to sit here was
 * missing 'credit', so the cage's payout dropdown could not offer a method the
 * database would have accepted - the kind of gap a private copy of a shared
 * vocabulary produces every time. The single source is
 * src/lib/commander/paymentMethods.js, checked against the live constraint.
 *
 * The two names are kept because both are already imported by screens; they
 * are now the same objects, not two lists that must be kept in step.
 */
export const PAYOUT_PAYMENT_METHODS = CASH_TX_PAYMENT_METHOD_OPTIONS;

export const DEFAULT_PAYOUT_PAYMENT_METHOD = DEFAULT_PAYMENT_METHOD;

/** Normalized payout status for an entry row. NULL reads as 'unpaid'. */
export function entryPayoutStatus(entry) {
  const raw = String(entry?.payout_status || '').toLowerCase();
  if (raw === PAYOUT_STATUS_PAID) return PAYOUT_STATUS_PAID;
  if (raw === PAYOUT_STATUS_VOIDED) return PAYOUT_STATUS_VOIDED;
  return PAYOUT_STATUS_UNPAID;
}

/**
 * Has the money physically left the drawer for this entry?
 * paid_at is checked as well as the status so a row stamped by any older code
 * path still reads as paid, exactly like reconciliation.js does it.
 */
export function isEntryPaid(entry) {
  if (!entry) return false;
  if (entry.paid_at) return true;
  return entryPayoutStatus(entry) === PAYOUT_STATUS_PAID;
}

/** Money figure, rounded to cents, never NaN. */
export function payoutMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Running paid / unpaid totals for a set of rows.
 *
 * A row only counts when it is really owed money and really exists as an entry:
 * a provisional place with no entry_id cannot be paid, so counting it would
 * make the outstanding figure permanently wrong.
 *
 * @param {Array<{entry_id?:string, amount?:number, paid?:boolean, projected?:boolean}>} rows
 * @returns {{ paidCount, paidTotal, unpaidCount, unpaidTotal, payableCount, total }}
 */
export function summarisePayouts(rows) {
  let paidCount = 0, paidTotal = 0, unpaidCount = 0, unpaidTotal = 0, payableCount = 0;

  for (const r of (rows || [])) {
    const amount = payoutMoney(r?.amount);
    if (!(amount > 0)) continue;
    if (r?.paid) {
      paidCount += 1;
      paidTotal += amount;
      continue;
    }
    unpaidCount += 1;
    unpaidTotal += amount;
    if (r?.entry_id && !r?.projected) payableCount += 1;
  }

  return {
    paidCount,
    paidTotal: payoutMoney(paidTotal),
    unpaidCount,
    unpaidTotal: payoutMoney(unpaidTotal),
    payableCount,
    total: payoutMoney(paidTotal + unpaidTotal)
  };
}

/** True when this row can be handed to the pay endpoint right now. */
export function isPayable(row) {
  return !!(row && row.entry_id && !row.projected && payoutMoney(row.amount) > 0 && !row.paid);
}

/**
 * Hand one finisher their money.
 *
 * Idempotent server-side: a double tap cannot pay twice. A 409 ALREADY_PAID is
 * returned as { ok:false, code:'ALREADY_PAID' } rather than thrown, because the
 * calling screen needs to show that specific message and offer a re-pay.
 *
 * @returns {Promise<{ ok:boolean, data?:object, code?:string, message?:string }>}
 */
export async function payTournamentEntry({ tournamentId, entryId, amount, paymentMethod, notes, force }) {
  if (!tournamentId || !entryId) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Tournament And Entry Are Both Required.' };
  }

  const body = {};
  if (amount !== undefined && amount !== null && amount !== '') body.amount = Number(amount);
  if (paymentMethod) body.payment_method = paymentMethod;
  if (notes) body.notes = notes;
  if (force) body.force = true;

  try {
    const res = await commanderFetch(
      `/api/commander/tournaments/${tournamentId}/entries/${entryId}/pay`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) return { ok: true, data: json.data };
    return {
      ok: false,
      code: json?.error?.code || 'SERVER_ERROR',
      message: json?.error?.message || 'The Payment Could Not Be Recorded.',
      data: json?.data
    };
  } catch (err) {
    console.warn('[payoutPayments] pay failed:', err?.message || err);
    return { ok: false, code: 'NETWORK_ERROR', message: 'The Payment Could Not Be Recorded. Check The Connection.' };
  }
}

/**
 * Reverse a payment. Voids the cash row and puts the entry back on the unpaid
 * list. For a mis-click at the window, not for a refund.
 */
export async function voidTournamentEntryPayment({ tournamentId, entryId, reason }) {
  if (!tournamentId || !entryId) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Tournament And Entry Are Both Required.' };
  }
  try {
    const res = await commanderFetch(
      `/api/commander/tournaments/${tournamentId}/entries/${entryId}/pay`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void', ...(reason ? { reason } : {}) })
      }
    );
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) return { ok: true, data: json.data };
    return {
      ok: false,
      code: json?.error?.code || 'SERVER_ERROR',
      message: json?.error?.message || 'The Payment Could Not Be Voided.'
    };
  } catch (err) {
    console.warn('[payoutPayments] void failed:', err?.message || err);
    return { ok: false, code: 'NETWORK_ERROR', message: 'The Payment Could Not Be Voided. Check The Connection.' };
  }
}

/**
 * Pay a whole list, one entry at a time.
 *
 * Deliberately sequential. The cage counts the money out one player at a time,
 * and firing ten writes at once against the same drawer makes a partial failure
 * impossible to read afterwards. Each result is reported individually so the
 * screen can name exactly who was missed.
 *
 * @param {Array} rows        rows shaped { entry_id, player_name, amount }
 * @param {object} options    { tournamentId, paymentMethod, notes, onProgress }
 * @returns {Promise<{ paid:Array, failed:Array, paidTotal:number }>}
 */
export async function payAllRemaining(rows, { tournamentId, paymentMethod, notes, onProgress } = {}) {
  const paid = [];
  const failed = [];
  let paidTotal = 0;

  const payable = (rows || []).filter(isPayable);

  for (let i = 0; i < payable.length; i++) {
    const row = payable[i];
    if (typeof onProgress === 'function') {
      onProgress({ index: i, total: payable.length, player_name: row.player_name });
    }
    const result = await payTournamentEntry({
      tournamentId,
      entryId: row.entry_id,
      amount: row.amount,
      paymentMethod,
      notes
    });
    if (result.ok) {
      paid.push({ ...row, transaction_id: result.data?.transaction_id || null });
      paidTotal += payoutMoney(result.data?.amount ?? row.amount);
    } else {
      failed.push({ ...row, code: result.code, message: result.message });
    }
  }

  return { paid, failed, paidTotal: payoutMoney(paidTotal) };
}
