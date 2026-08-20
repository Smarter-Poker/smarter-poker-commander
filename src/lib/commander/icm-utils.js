/**
 * ICM (Independent Chip Model) - Commander-local override (2026-07-26 audit).
 *
 * Previously re-exported the shared package. Now owns a corrected
 * implementation; the only consumer (pages/commander/tournaments/[id]/clock-display.js)
 * already imports this local path, so no call sites change.
 *
 * THE BUG THIS FIXES
 * ------------------
 * The shared version advertised Malmuth-Harville but only handled 1st, 2nd and
 * (partially) 3rd place exactly. For 4th place and deeper it fell back to
 *     prob += pFirst * (stack / remainingTotal) * (1 / position)
 * which is not a probability distribution. Across players the per-position
 * probabilities did not sum to 1, so the reported equities did not sum to the
 * prize pool. Deals struck off those numbers mis-allocated real money.
 *
 * THE CORRECT METHOD
 * ------------------
 * Malmuth-Harville states that, given a set of players who have already
 * finished, the next player to finish is drawn proportionally to the chips
 * remaining. That yields an exact dynamic program over subsets:
 *
 *   f[S] = probability that exactly the players in S have finished (any order)
 *   f[{}] = 1
 *   f[S u {i}] += f[S] * stack[i] / (totalChips - chips(S))
 *
 * and P(player i finishes in position |S|) = f[S] * stack[i] / (total - chips(S))
 * summed over every S not containing i. Because exactly one player occupies
 * each position, the per-position probabilities sum to 1 by construction, so
 * the equities sum to the prize pool exactly.
 *
 * Cost is O(2^n * n). We run it exactly up to EXACT_MAX players, which covers
 * every situation where a deal is actually struck (final tables). Above that we
 * use a compressed, explicitly normalised approximation - see largeFieldEquities.
 */

const EXACT_MAX = 18;

/** Round an array of values to cents so the total matches `target` exactly. */
function reconcileToTotal(values, target) {
  const cents = values.map((v) => Math.round(v * 100));
  const targetCents = Math.round(target * 100);
  let drift = targetCents - cents.reduce((a, b) => a + b, 0);
  if (drift !== 0 && cents.length > 0) {
    // Hand the rounding remainder to the largest share, one cent at a time,
    // so the payout table always adds up to the pool.
    const order = cents
      .map((c, i) => ({ c, i }))
      .sort((a, b) => b.c - a.c)
      .map((x) => x.i);
    let k = 0;
    const step = drift > 0 ? 1 : -1;
    while (drift !== 0) {
      cents[order[k % order.length]] += step;
      drift -= step;
      k++;
    }
  }
  return cents.map((c) => c / 100);
}

/** Exact Malmuth-Harville equities via subset DP. */
function exactEquities(stacks, prizes, totalChips) {
  const n = stacks.length;
  const paid = Math.min(prizes.length, n);
  const size = 1 << n;

  const f = new Float64Array(size);
  const chipsIn = new Float64Array(size);
  const finishedCount = new Uint8Array(size);
  f[0] = 1;

  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    const idx = 31 - Math.clz32(low);
    const rest = mask ^ low;
    chipsIn[mask] = chipsIn[rest] + stacks[idx];
    finishedCount[mask] = finishedCount[rest] + 1;
  }

  const equities = new Array(n).fill(0);

  for (let mask = 0; mask < size; mask++) {
    const prob = f[mask];
    if (prob === 0) continue;
    const position = finishedCount[mask]; // 0-indexed position about to be filled
    if (position >= paid) continue;       // no prize left to award: stop expanding
    const remaining = totalChips - chipsIn[mask];
    if (remaining <= 0) continue;

    const prize = prizes[position] || 0;
    for (let i = 0; i < n; i++) {
      const bit = 1 << i;
      if (mask & bit) continue;
      const step = prob * (stacks[i] / remaining);
      if (step === 0) continue;
      equities[i] += step * prize;
      f[mask | bit] += step;
    }
  }

  return equities;
}

/**
 * Approximation for fields too large for the exact DP.
 *
 * Uses a power-law compression of chip share (exponent < 1 pulls equity down
 * for big stacks and up for short stacks, which is the direction ICM moves)
 * and then normalises across players. Normalisation is what guarantees the
 * equities still sum to the prize pool - the defect being fixed here.
 */
function largeFieldEquities(stacks, totalPrize, totalChips) {
  const COMPRESSION = 0.85;
  const weights = stacks.map((s) => Math.pow(Math.max(s, 0) / totalChips, COMPRESSION));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return stacks.map(() => 0);
  return weights.map((w) => (w / weightSum) * totalPrize);
}

/**
 * Calculate ICM equity for all players.
 * @param {number[]} stacks - chip stacks for each remaining player
 * @param {number[]} prizes - prize amounts (1st, 2nd, 3rd, ...)
 * @returns {Object[]} [{ stack, equity, percentage }]
 */
export function calculateICM(stacks, prizes) {
  if (!stacks || stacks.length === 0) return [];
  if (!prizes || prizes.length === 0) {
    return stacks.map((s) => ({ stack: s, equity: 0, percentage: 0 }));
  }

  const safeStacks = stacks.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const totalChips = safeStacks.reduce((sum, s) => sum + s, 0);
  const totalPrize = prizes.reduce((sum, p) => sum + (Number(p) || 0), 0);

  if (totalChips === 0) {
    return stacks.map((s) => ({ stack: s, equity: 0, percentage: 0 }));
  }

  const raw = safeStacks.length <= EXACT_MAX
    ? exactEquities(safeStacks, prizes, totalChips)
    : largeFieldEquities(safeStacks, totalPrize, totalChips);

  // Only players with chips can hold equity; reconcile cents against the pool.
  const settled = reconcileToTotal(raw, totalPrize);

  return stacks.map((stack, i) => ({
    stack,
    equity: settled[i],
    percentage: totalPrize > 0 ? Math.round((settled[i] / totalPrize) * 10000) / 100 : 0,
  }));
}

/**
 * Calculate chip chop (chip-proportional split of the pool).
 * @param {number[]} stacks
 * @param {number} totalPrize
 * @returns {Object[]} [{ stack, chop, percentage }]
 */
export function calculateChipChop(stacks, totalPrize) {
  if (!stacks || stacks.length === 0 || !totalPrize) return [];
  const safeStacks = stacks.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const totalChips = safeStacks.reduce((sum, s) => sum + s, 0);
  if (totalChips === 0) return stacks.map((s) => ({ stack: s, chop: 0, percentage: 0 }));

  // 2026-07-26 audit fix: reconcile the rounding remainder so the chop totals
  // the prize pool to the cent instead of drifting a few cents off.
  const raw = safeStacks.map((s) => (s / totalChips) * totalPrize);
  const settled = reconcileToTotal(raw, totalPrize);

  return stacks.map((stack, i) => ({
    stack,
    chop: settled[i],
    percentage: Math.round((safeStacks[i] / totalChips) * 10000) / 100,
  }));
}

/**
 * Format money value
 * @param {number} amount
 * @returns {string}
 */
export function formatPrize(amount) {
  if (!amount && amount !== 0) return '$0.00';
  return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
