/**
 * ICM correctness — regression cover for the 2026-07-26 audit fix.
 *
 * The implementation this replaced handled 1st, 2nd and partially 3rd place
 * exactly, then fell back to `pFirst * (stack / remainingTotal) * (1 / position)`
 * for deeper finishes. That expression is not a probability distribution, so
 * per-position probabilities did not sum to 1 and the reported equities did not
 * sum to the prize pool. Measured against real pools it lost 10.0% on a
 * 3-handed $10,000 pool, 11.6% on 5-handed $24,000 and 21.6% on 9-handed
 * $25,200 — money a tournament director would have negotiated a deal against.
 *
 * The sum-to-pool assertions below are the ones that would have caught it.
 */
import { describe, it, expect } from 'vitest';
import { calculateICM, calculateChipChop, formatPrize } from '../../src/lib/commander/icm-utils';

const sum = (a) => a.reduce((x, y) => x + y, 0);
const equities = (r) => r.map((x) => x.equity);

describe('calculateICM — equities must sum to the prize pool', () => {
  const cases = [
    { name: '3 players, 3 paid', stacks: [50000, 30000, 20000], prizes: [5000, 3000, 2000] },
    { name: '5 players, 5 paid', stacks: [100000, 50000, 25000, 15000, 10000], prizes: [10000, 6000, 4000, 2500, 1500] },
    { name: '9 handed final table', stacks: new Array(9).fill(40000), prizes: [9000, 5400, 3600, 2400, 1800, 1200, 900, 600, 300] },
    { name: 'tiny equal stacks', stacks: [1, 1, 1, 1], prizes: [100, 50] },
    { name: 'one dominant stack', stacks: [999999, 1, 1], prizes: [1000, 500, 250] },
    { name: 'more players than paid places', stacks: [8000, 6000, 5000, 4000, 3000, 2000], prizes: [5000, 3000] },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const pool = sum(c.prizes);
      const got = sum(equities(calculateICM(c.stacks, c.prizes)));
      expect(Math.abs(got - pool)).toBeLessThan(0.005);
    });
  }

  it('large field beyond the exact-DP ceiling still sums to the pool', () => {
    const stacks = Array.from({ length: 40 }, (_, i) => 1000 + i * 137);
    const prizes = [10000, 6000, 4000, 2500, 1500, 1000, 800, 600, 400];
    const got = sum(equities(calculateICM(stacks, prizes)));
    expect(Math.abs(got - sum(prizes))).toBeLessThan(0.005);
  });
});

describe('calculateICM — known results', () => {
  it('heads-up winner-take-all is chip-proportional', () => {
    const r = equities(calculateICM([75000, 25000], [1000]));
    expect(r[0]).toBeCloseTo(750, 2);
    expect(r[1]).toBeCloseTo(250, 2);
  });

  it('equal stacks split the pool equally', () => {
    const r = equities(calculateICM([1000, 1000, 1000, 1000], [4000, 3000, 2000, 1000]));
    for (const e of r) expect(e).toBeCloseTo(2500, 2);
  });

  it('compresses relative to a chip chop: leader gets less, short stack more', () => {
    const stacks = [70000, 20000, 10000];
    const prizes = [5000, 3000, 2000];
    const icm = equities(calculateICM(stacks, prizes));
    const chop = calculateChipChop(stacks, sum(prizes)).map((x) => x.chop);
    expect(icm[0]).toBeLessThan(chop[0]);
    expect(icm[2]).toBeGreaterThan(chop[2]);
  });

  it('equity never increases as stack decreases', () => {
    const r = equities(calculateICM([90000, 60000, 30000, 20000, 100], [8000, 5000, 3000, 2000, 1000]));
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeLessThanOrEqual(r[i - 1] + 1e-9);
  });
});

describe('calculateChipChop', () => {
  it('reconciles rounding so the split totals the pool exactly', () => {
    const r = calculateChipChop([1, 1, 1], 100);
    expect(sum(r.map((x) => x.chop))).toBeCloseTo(100, 6);
  });

  it('is chip-proportional', () => {
    const r = calculateChipChop([50, 50], 1000);
    expect(r[0].chop).toBeCloseTo(500, 2);
    expect(r[1].chop).toBeCloseTo(500, 2);
  });
});

describe('degenerate input is safe', () => {
  it('empty stacks', () => expect(calculateICM([], [100])).toEqual([]));
  it('no prizes', () => expect(equities(calculateICM([100, 200], []))).toEqual([0, 0]));
  it('zero chips', () => expect(equities(calculateICM([0, 0], [100]))).toEqual([0, 0]));
  it('formatPrize handles null', () => expect(formatPrize(null)).toBe('$0.00'));
});
