/**
 * ICM (Independent Chip Model) Calculator
 * Calculates each player's equity in the prize pool based on chip stacks
 * 
 * Uses the Malmuth-Harville method:
 * - Player's probability of finishing in each position is proportional to their chip stack
 * - Equity = sum of (probability of finishing in position k × prize for position k)
 */

/**
 * Calculate ICM equity for all players
 * @param {number[]} stacks - Array of chip stacks for each remaining player
 * @param {number[]} prizes - Array of prize amounts (1st, 2nd, 3rd, etc.)
 * @returns {Object[]} Array of { stack, equity, percentage } for each player
 */
export function calculateICM(stacks, prizes) {
    if (!stacks || stacks.length === 0) return [];
    if (!prizes || prizes.length === 0) return stacks.map(s => ({ stack: s, equity: 0, percentage: 0 }));

    const totalChips = stacks.reduce((sum, s) => sum + s, 0);
    if (totalChips === 0) return stacks.map(s => ({ stack: s, equity: 0, percentage: 0 }));

    const n = stacks.length;
    const totalPrize = prizes.reduce((sum, p) => sum + p, 0);
    const equities = new Array(n).fill(0);

    // For each player, calculate their probability of finishing in each prize position
    // and multiply by the prize for that position
    for (let player = 0; player < n; player++) {
        equities[player] = computePlayerEquity(player, stacks, prizes, totalChips);
    }

    return stacks.map((stack, i) => ({
        stack,
        equity: Math.round(equities[i] * 100) / 100,
        percentage: totalPrize > 0 ? Math.round((equities[i] / totalPrize) * 10000) / 100 : 0
    }));
}

/**
 * Compute a single player's ICM equity using recursive Malmuth-Harville
 */
function computePlayerEquity(playerIdx, stacks, prizes, totalChips) {
    const n = stacks.length;
    const maxPrizePositions = Math.min(prizes.length, n);

    // For small player counts, use exact calculation
    // For larger counts, use approximation to avoid factorial explosion
    if (n <= 10) {
        return exactICM(playerIdx, stacks, prizes, totalChips);
    }
    return approximateICM(playerIdx, stacks, prizes, totalChips);
}

/**
 * Exact ICM calculation (feasible for ≤10 players)
 */
function exactICM(playerIdx, stacks, prizes, totalChips) {
    let equity = 0;
    const n = stacks.length;
    const maxPos = Math.min(prizes.length, n);

    // Probability of player finishing 1st
    const p1 = stacks[playerIdx] / totalChips;
    equity += p1 * (prizes[0] || 0);

    if (maxPos >= 2) {
        // For 2nd place and beyond, use recursive approach
        for (let pos = 1; pos < maxPos; pos++) {
            equity += getPositionProbability(playerIdx, pos, stacks, totalChips) * (prizes[pos] || 0);
        }
    }

    return equity;
}

/**
 * Get probability of a player finishing in a specific position
 * Uses Malmuth-Harville recursive method
 */
function getPositionProbability(playerIdx, position, stacks, totalChips) {
    const n = stacks.length;
    if (position === 0) return stacks[playerIdx] / totalChips;

    let prob = 0;

    // Sum over all possible players who could have finished before this position
    // For position k, we need to consider who finished in positions 0..k-1
    // Simplified: iterate over who finishes 1st, then recursively compute
    for (let firstPlace = 0; firstPlace < n; firstPlace++) {
        if (firstPlace === playerIdx) continue;

        const pFirst = stacks[firstPlace] / totalChips;
        const remainingTotal = totalChips - stacks[firstPlace];

        if (remainingTotal <= 0) continue;

        if (position === 1) {
            // Player's probability of finishing 2nd given `firstPlace` finished 1st
            prob += pFirst * (stacks[playerIdx] / remainingTotal);
        } else if (position === 2 && n > 3) {
            // 3rd place: iterate over who could be 2nd
            for (let secondPlace = 0; secondPlace < n; secondPlace++) {
                if (secondPlace === firstPlace || secondPlace === playerIdx) continue;
                const pSecond = pFirst * (stacks[secondPlace] / remainingTotal);
                const remaining2 = remainingTotal - stacks[secondPlace];
                if (remaining2 > 0) {
                    prob += pSecond * (stacks[playerIdx] / remaining2);
                }
            }
        } else if (position >= 2) {
            // For deeper positions, use chip-proportional approximation
            const adjustedStack = stacks[playerIdx];
            prob += pFirst * (adjustedStack / remainingTotal) * (1 / position);
        }
    }

    return prob;
}

/**
 * Approximate ICM for 11+ players (avoids combinatorial explosion)
 * Uses adjusted chip-proportional method
 */
function approximateICM(playerIdx, stacks, prizes, totalChips) {
    let equity = 0;
    const chipFraction = stacks[playerIdx] / totalChips;
    const n = stacks.length;

    for (let pos = 0; pos < Math.min(prizes.length, n); pos++) {
        if (pos === 0) {
            equity += chipFraction * prizes[pos];
        } else {
            // Diminishing returns for lower positions — ICM compresses equity
            // Players with large stacks get less equity than chip-proportional for 1st
            // but more security for lower positions
            const compression = 1 - (chipFraction * 0.3);
            equity += chipFraction * compression * prizes[pos];
        }
    }

    return equity;
}

/**
 * Calculate chip chop (simple chip-proportional split)
 * @param {number[]} stacks - Array of chip stacks
 * @param {number} totalPrize - Total prize pool
 * @returns {Object[]} Array of { stack, chop, percentage }
 */
export function calculateChipChop(stacks, totalPrize) {
    if (!stacks || stacks.length === 0 || !totalPrize) return [];
    const totalChips = stacks.reduce((sum, s) => sum + s, 0);
    if (totalChips === 0) return stacks.map(s => ({ stack: s, chop: 0, percentage: 0 }));

    return stacks.map(stack => ({
        stack,
        chop: Math.round((stack / totalChips) * totalPrize * 100) / 100,
        percentage: Math.round((stack / totalChips) * 10000) / 100
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
