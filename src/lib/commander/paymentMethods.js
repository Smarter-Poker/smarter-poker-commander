/**
 * Cash Transaction Payment Methods - ONE vocabulary, one place.
 *
 * WHY THIS FILE EXISTS
 * `commander_cash_transactions.payment_method` is guarded by a CHECK
 * constraint, and until 2026-08-22 three separate files each carried their own
 * hand-maintained copy of what that constraint accepts:
 *
 *   pages/api/tournaments/[id]/entries/[entryId]/pay.js   8 of 8  (correct)
 *   src/lib/commander/payoutPayments.js                   7 of 8  (no 'credit')
 *   pages/api/tournaments/[id]/register.js                4 of 8  (no credit,
 *                                                                  chips,
 *                                                                  transfer,
 *                                                                  other)
 *
 * None of those failed loudly. `register.js` silently rewrote any method it
 * did not recognise to 'cash', so a buy-in genuinely taken on chips or by
 * transfer was FILED AS CASH and the drawer reconciliation then reported a
 * by-payment-method breakdown that did not match what the cage did. A list
 * that only narrows what it forwards is not harmless when the thing it feeds
 * is a reconciliation report.
 *
 * The list below is the live CHECK constraint, verified 2026-08-22:
 *
 *   CHECK (payment_method IS NULL OR payment_method = ANY (ARRAY[
 *     'cash', 'card', 'credit', 'comp', 'chips', 'transfer', 'marker', 'other'
 *   ]))
 *
 * If that constraint ever changes, change it HERE and nowhere else. Adding a
 * fourth private copy is the bug this file closes.
 *
 * Dependency-free on purpose: imported by server API routes and by client
 * components alike, so it must not pull in anything environment-specific.
 */

/**
 * Every value the live CHECK accepts, in cage-window order (the order a cashier
 * actually reaches for them), not alphabetical. Used for both the API-side
 * validation and the order options render in.
 */
export const CASH_TX_PAYMENT_METHOD_OPTIONS = Object.freeze([
  Object.freeze({ value: 'cash', label: 'Cash' }),
  Object.freeze({ value: 'chips', label: 'Chips' }),
  Object.freeze({ value: 'card', label: 'Card' }),
  Object.freeze({ value: 'credit', label: 'Credit' }),
  Object.freeze({ value: 'transfer', label: 'Transfer' }),
  Object.freeze({ value: 'marker', label: 'Marker' }),
  Object.freeze({ value: 'comp', label: 'Comp' }),
  Object.freeze({ value: 'other', label: 'Other' })
]);

/** Bare values, for validation and error messages. */
export const CASH_TX_PAYMENT_METHODS = Object.freeze(
  CASH_TX_PAYMENT_METHOD_OPTIONS.map(o => o.value)
);

/**
 * What an unspecified method is filed as. The column is nullable, but every
 * writer in this repo has always defaulted rather than storing NULL, and the
 * reconciliation's by-method breakdown reads better with a real bucket.
 */
export const DEFAULT_PAYMENT_METHOD = 'cash';

/** True when `value` is a method the CHECK constraint will accept. */
export function isCashTxPaymentMethod(value) {
  return CASH_TX_PAYMENT_METHODS.includes(String(value || '').toLowerCase());
}

/**
 * Coerce caller input to a storable method.
 *
 * Case-insensitive, because the request body is user input and the constraint
 * is not. Falls back to `fallback` (default 'cash') for anything unrecognised
 * so a bad value can never reject an otherwise-good registration insert.
 */
export function normalizeCashTxPaymentMethod(value, fallback = DEFAULT_PAYMENT_METHOD) {
  const v = String(value || '').toLowerCase();
  return CASH_TX_PAYMENT_METHODS.includes(v) ? v : fallback;
}

/** Human label for a stored value. Falls back to the raw value. */
export function cashTxPaymentMethodLabel(value) {
  const v = String(value || '').toLowerCase();
  return CASH_TX_PAYMENT_METHOD_OPTIONS.find(o => o.value === v)?.label || String(value || '');
}

export default {
  CASH_TX_PAYMENT_METHODS,
  CASH_TX_PAYMENT_METHOD_OPTIONS,
  DEFAULT_PAYMENT_METHOD,
  isCashTxPaymentMethod,
  normalizeCashTxPaymentMethod,
  cashTxPaymentMethodLabel
};
