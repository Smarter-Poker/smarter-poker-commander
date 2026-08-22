/**
 * Payment method vocabulary — drift guard.
 *
 * The bug this pins (fixed 2026-08-22): three files each carried their own
 * hand-typed copy of what commander_cash_transactions.payment_method accepts.
 * Two were wrong. register.js listed 4 of 8, and because its only use was
 * `includes(m) ? m : 'cash'`, a buy-in taken on chips/credit/transfer was
 * silently FILED AS CASH — no error, just a reconciliation breakdown that did
 * not match what the cage did.
 *
 * These tests fail if the copies come back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  CASH_TX_PAYMENT_METHODS,
  CASH_TX_PAYMENT_METHOD_OPTIONS,
  DEFAULT_PAYMENT_METHOD,
  isCashTxPaymentMethod,
  normalizeCashTxPaymentMethod,
  cashTxPaymentMethodLabel
} from '../../src/lib/commander/paymentMethods';
import {
  PAYOUT_PAYMENT_METHODS,
  DEFAULT_PAYOUT_PAYMENT_METHOD
} from '../../src/lib/commander/payoutPayments';

// The live CHECK constraint on BOTH commander_cash_transactions.payment_method
// and commander_tournament_entries.payment_method, verified 2026-08-22. If a
// migration changes the constraint, this array changes with it, in one place.
const LIVE_CHECK_VALUES = [
  'cash', 'card', 'credit', 'comp', 'chips', 'transfer', 'marker', 'other'
];

describe('payment method vocabulary', () => {
  it('covers exactly the values the live CHECK constraint accepts', () => {
    expect([...CASH_TX_PAYMENT_METHODS].sort()).toEqual([...LIVE_CHECK_VALUES].sort());
  });

  it('carries a label for every value, with no duplicates', () => {
    expect(CASH_TX_PAYMENT_METHOD_OPTIONS).toHaveLength(LIVE_CHECK_VALUES.length);
    for (const o of CASH_TX_PAYMENT_METHOD_OPTIONS) {
      expect(typeof o.label).toBe('string');
      expect(o.label.length).toBeGreaterThan(0);
    }
    expect(new Set(CASH_TX_PAYMENT_METHODS).size).toBe(CASH_TX_PAYMENT_METHODS.length);
  });

  it('defaults to a value the constraint accepts', () => {
    expect(CASH_TX_PAYMENT_METHODS).toContain(DEFAULT_PAYMENT_METHOD);
  });

  // This is the actual regression. 'chips', 'credit', 'transfer' and 'other'
  // are the four register.js used to drop on the floor.
  it.each(['chips', 'credit', 'transfer', 'other'])(
    'stores %s as itself rather than relabelling it cash',
    (method) => {
      expect(normalizeCashTxPaymentMethod(method)).toBe(method);
      expect(isCashTxPaymentMethod(method)).toBe(true);
    }
  );

  it('is case-insensitive, because request bodies are user input', () => {
    expect(normalizeCashTxPaymentMethod('Chips')).toBe('chips');
    expect(normalizeCashTxPaymentMethod('TRANSFER')).toBe('transfer');
  });

  it('falls back rather than passing an illegal value to the constraint', () => {
    expect(normalizeCashTxPaymentMethod('bitcoin')).toBe(DEFAULT_PAYMENT_METHOD);
    expect(normalizeCashTxPaymentMethod(null)).toBe(DEFAULT_PAYMENT_METHOD);
    expect(normalizeCashTxPaymentMethod(undefined)).toBe(DEFAULT_PAYMENT_METHOD);
    expect(normalizeCashTxPaymentMethod('')).toBe(DEFAULT_PAYMENT_METHOD);
    expect(isCashTxPaymentMethod('bitcoin')).toBe(false);
  });

  it('labels a known value and passes an unknown one through', () => {
    expect(cashTxPaymentMethodLabel('chips')).toBe('Chips');
    expect(cashTxPaymentMethodLabel('bitcoin')).toBe('bitcoin');
  });

  it('is the SAME list the cage payout dropdown renders', () => {
    // Not "equal to" — the same objects. Two lists that merely agree today are
    // how this drifted in the first place.
    expect(PAYOUT_PAYMENT_METHODS).toBe(CASH_TX_PAYMENT_METHOD_OPTIONS);
    expect(DEFAULT_PAYOUT_PAYMENT_METHOD).toBe(DEFAULT_PAYMENT_METHOD);
  });

  it('is frozen, so a caller cannot mutate the shared vocabulary', () => {
    expect(Object.isFrozen(CASH_TX_PAYMENT_METHODS)).toBe(true);
    expect(Object.isFrozen(CASH_TX_PAYMENT_METHOD_OPTIONS)).toBe(true);
  });
});

describe('no file re-declares the vocabulary privately', () => {
  const ROOT = join(__dirname, '..', '..');
  const CANONICAL = 'src/lib/commander/paymentMethods.js';

  function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.next' || ent.name === '.git') continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p, out);
      else if (/\.(js|jsx)$/.test(ent.name)) out.push(p);
    }
    return out;
  }

  it('finds no second array literal listing the payment methods', () => {
    // A private copy looks like an array literal holding three or more of the
    // constraint's values. That shape is specific enough not to fire on prose
    // and loose enough to catch a partial copy like the 4-value one.
    const offenders = [];
    for (const file of walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'pages')))) {
      const rel = file.slice(ROOT.length + 1).split('\\').join('/');
      if (rel === CANONICAL) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\[[^\][]{0,400}?\]/gs)) {
        const hits = LIVE_CHECK_VALUES.filter(v =>
          new RegExp(`['"\`]${v}['"\`]`).test(m[0])
        );
        if (hits.length >= 3) {
          offenders.push(`${rel}: ${m[0].slice(0, 120)}`);
        }
      }
    }
    expect(offenders, `Import from ${CANONICAL} instead of re-declaring:\n${offenders.join('\n')}`)
      .toEqual([]);
  });
});
