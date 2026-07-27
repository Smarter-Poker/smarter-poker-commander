/**
 * Tournament Templates — 7 Industry-Standard Tournament Structures
 * Expert blind structures with proper antes, breaks, and escalation
 * Used by Tournament Settings page and CreateTournamentModal
 */

// ═══════════════════════════════════════════════
// TEMPLATE 1: Daily Deepstack
// $150+$30 | 20,000 chips | 20-min levels | ~5 hrs
// ═══════════════════════════════════════════════
const DAILY_DEEPSTACK_BLINDS = [
    { level: 1, small_blind: 50, big_blind: 100, ante: 0, duration: 20 },
    { level: 2, small_blind: 75, big_blind: 150, ante: 0, duration: 20 },
    { level: 3, small_blind: 100, big_blind: 200, ante: 25, duration: 20 },
    { level: 4, small_blind: 150, big_blind: 300, ante: 50, duration: 20 },
    { is_break: true, duration: 10, label: 'Break' },
    { level: 5, small_blind: 200, big_blind: 400, ante: 50, duration: 20 },
    { level: 6, small_blind: 250, big_blind: 500, ante: 75, duration: 20 },
    { level: 7, small_blind: 300, big_blind: 600, ante: 100, duration: 20 },
    { level: 8, small_blind: 400, big_blind: 800, ante: 100, duration: 20 },
    { is_break: true, duration: 15, label: 'Break + Color Up' },
    { level: 9, small_blind: 500, big_blind: 1000, ante: 150, duration: 20 },
    { level: 10, small_blind: 600, big_blind: 1200, ante: 200, duration: 20 },
    { level: 11, small_blind: 800, big_blind: 1600, ante: 200, duration: 20 },
    { level: 12, small_blind: 1000, big_blind: 2000, ante: 300, duration: 20 },
    { is_break: true, duration: 10, label: 'Break' },
    { level: 13, small_blind: 1500, big_blind: 3000, ante: 400, duration: 15 },
    { level: 14, small_blind: 2000, big_blind: 4000, ante: 500, duration: 15 },
    { level: 15, small_blind: 2500, big_blind: 5000, ante: 500, duration: 15 },
    { level: 16, small_blind: 3000, big_blind: 6000, ante: 1000, duration: 15 },
    { level: 17, small_blind: 4000, big_blind: 8000, ante: 1000, duration: 15 },
    { level: 18, small_blind: 5000, big_blind: 10000, ante: 1500, duration: 15 },
];

// ═══════════════════════════════════════════════
// TEMPLATE 2: Nightly Turbo
// $80+$15 | 10,000 chips | 12-min levels | ~3 hrs
// ═══════════════════════════════════════════════
const NIGHTLY_TURBO_BLINDS = [
    { level: 1, small_blind: 25, big_blind: 50, ante: 0, duration: 12 },
    { level: 2, small_blind: 50, big_blind: 100, ante: 0, duration: 12 },
    { level: 3, small_blind: 75, big_blind: 150, ante: 25, duration: 12 },
    { level: 4, small_blind: 100, big_blind: 200, ante: 25, duration: 12 },
    { is_break: true, duration: 10, label: 'Break' },
    { level: 5, small_blind: 150, big_blind: 300, ante: 50, duration: 12 },
    { level: 6, small_blind: 200, big_blind: 400, ante: 50, duration: 12 },
    { level: 7, small_blind: 300, big_blind: 600, ante: 75, duration: 12 },
    { level: 8, small_blind: 400, big_blind: 800, ante: 100, duration: 12 },
    { is_break: true, duration: 10, label: 'Break + Color Up' },
    { level: 9, small_blind: 500, big_blind: 1000, ante: 100, duration: 10 },
    { level: 10, small_blind: 600, big_blind: 1200, ante: 200, duration: 10 },
    { level: 11, small_blind: 800, big_blind: 1600, ante: 200, duration: 10 },
    { level: 12, small_blind: 1000, big_blind: 2000, ante: 300, duration: 10 },
    { level: 13, small_blind: 1500, big_blind: 3000, ante: 400, duration: 10 },
    { level: 14, small_blind: 2000, big_blind: 4000, ante: 500, duration: 10 },
    { level: 15, small_blind: 3000, big_blind: 6000, ante: 1000, duration: 10 },
];

// ═══════════════════════════════════════════════
// TEMPLATE 3: Weekend Major
// $300+$50 | 30,000 chips | 30-min levels | ~8 hrs
// ═══════════════════════════════════════════════
const WEEKEND_MAJOR_BLINDS = [
    { level: 1, small_blind: 50, big_blind: 100, ante: 0, duration: 30 },
    { level: 2, small_blind: 75, big_blind: 150, ante: 0, duration: 30 },
    { level: 3, small_blind: 100, big_blind: 200, ante: 25, duration: 30 },
    { level: 4, small_blind: 150, big_blind: 300, ante: 50, duration: 30 },
    { is_break: true, duration: 15, label: 'Break' },
    { level: 5, small_blind: 200, big_blind: 400, ante: 50, duration: 30 },
    { level: 6, small_blind: 250, big_blind: 500, ante: 75, duration: 30 },
    { level: 7, small_blind: 300, big_blind: 600, ante: 100, duration: 30 },
    { level: 8, small_blind: 400, big_blind: 800, ante: 100, duration: 30 },
    { is_break: true, duration: 20, label: 'Dinner Break + Color Up' },
    { level: 9, small_blind: 500, big_blind: 1000, ante: 150, duration: 30 },
    { level: 10, small_blind: 600, big_blind: 1200, ante: 200, duration: 30 },
    { level: 11, small_blind: 800, big_blind: 1600, ante: 200, duration: 25 },
    { level: 12, small_blind: 1000, big_blind: 2000, ante: 300, duration: 25 },
    { is_break: true, duration: 15, label: 'Break + Color Up' },
    { level: 13, small_blind: 1500, big_blind: 3000, ante: 400, duration: 25 },
    { level: 14, small_blind: 2000, big_blind: 4000, ante: 500, duration: 25 },
    { level: 15, small_blind: 2500, big_blind: 5000, ante: 500, duration: 20 },
    { level: 16, small_blind: 3000, big_blind: 6000, ante: 1000, duration: 20 },
    { is_break: true, duration: 10, label: 'Break' },
    { level: 17, small_blind: 4000, big_blind: 8000, ante: 1000, duration: 20 },
    { level: 18, small_blind: 5000, big_blind: 10000, ante: 1500, duration: 20 },
    { level: 19, small_blind: 6000, big_blind: 12000, ante: 2000, duration: 20 },
    { level: 20, small_blind: 8000, big_blind: 16000, ante: 2000, duration: 15 },
    { level: 21, small_blind: 10000, big_blind: 20000, ante: 3000, duration: 15 },
];

// ═══════════════════════════════════════════════
// TEMPLATE 4: Bounty Hunter
// $100+$20+$50 bounty | 15,000 chips | 15-min levels | ~4 hrs
// ═══════════════════════════════════════════════
const BOUNTY_HUNTER_BLINDS = [
    { level: 1, small_blind: 25, big_blind: 50, ante: 0, duration: 15 },
    { level: 2, small_blind: 50, big_blind: 100, ante: 0, duration: 15 },
    { level: 3, small_blind: 75, big_blind: 150, ante: 25, duration: 15 },
    { level: 4, small_blind: 100, big_blind: 200, ante: 25, duration: 15 },
    { is_break: true, duration: 10, label: 'Break' },
    { level: 5, small_blind: 150, big_blind: 300, ante: 50, duration: 15 },
    { level: 6, small_blind: 200, big_blind: 400, ante: 50, duration: 15 },
    { level: 7, small_blind: 250, big_blind: 500, ante: 75, duration: 15 },
    { level: 8, small_blind: 300, big_blind: 600, ante: 100, duration: 15 },
    { is_break: true, duration: 10, label: 'Break + Color Up' },
    { level: 9, small_blind: 400, big_blind: 800, ante: 100, duration: 15 },
    { level: 10, small_blind: 500, big_blind: 1000, ante: 150, duration: 15 },
    { level: 11, small_blind: 600, big_blind: 1200, ante: 200, duration: 12 },
    { level: 12, small_blind: 800, big_blind: 1600, ante: 200, duration: 12 },
    { is_break: true, duration: 10, label: 'Break' },
    { level: 13, small_blind: 1000, big_blind: 2000, ante: 300, duration: 12 },
    { level: 14, small_blind: 1500, big_blind: 3000, ante: 400, duration: 12 },
    { level: 15, small_blind: 2000, big_blind: 4000, ante: 500, duration: 10 },
    { level: 16, small_blind: 3000, big_blind: 6000, ante: 1000, duration: 10 },
];

// ═══════════════════════════════════════════════
// TEMPLATE 5: Rebuy Madness
// $60+$10 | 8,000 chips | 15-min levels | Rebuys L1-6 | ~4 hrs
// ═══════════════════════════════════════════════
const REBUY_MADNESS_BLINDS = [
    { level: 1, small_blind: 25, big_blind: 50, ante: 0, duration: 15 },
    { level: 2, small_blind: 50, big_blind: 100, ante: 0, duration: 15 },
    { level: 3, small_blind: 75, big_blind: 150, ante: 0, duration: 15 },
    { level: 4, small_blind: 100, big_blind: 200, ante: 25, duration: 15 },
    { is_break: true, duration: 10, label: 'Break' },
    { level: 5, small_blind: 150, big_blind: 300, ante: 50, duration: 15 },
    { level: 6, small_blind: 200, big_blind: 400, ante: 50, duration: 15 },
    { is_break: true, duration: 15, label: 'Add-On Break (Last Rebuy/Add-On)' },
    { level: 7, small_blind: 300, big_blind: 600, ante: 75, duration: 15 },
    { level: 8, small_blind: 400, big_blind: 800, ante: 100, duration: 15 },
    { level: 9, small_blind: 500, big_blind: 1000, ante: 100, duration: 15 },
    { level: 10, small_blind: 600, big_blind: 1200, ante: 200, duration: 12 },
    { is_break: true, duration: 10, label: 'Break + Color Up' },
    { level: 11, small_blind: 800, big_blind: 1600, ante: 200, duration: 12 },
    { level: 12, small_blind: 1000, big_blind: 2000, ante: 300, duration: 12 },
    { level: 13, small_blind: 1500, big_blind: 3000, ante: 400, duration: 10 },
    { level: 14, small_blind: 2000, big_blind: 4000, ante: 500, duration: 10 },
    { level: 15, small_blind: 3000, big_blind: 6000, ante: 1000, duration: 10 },
];

// ═══════════════════════════════════════════════
// TEMPLATE 6: Satellite Qualifier
// $50+$10 | 5,000 chips | 10-min levels | ~2 hrs
// ═══════════════════════════════════════════════
const SATELLITE_QUALIFIER_BLINDS = [
    { level: 1, small_blind: 25, big_blind: 50, ante: 0, duration: 10 },
    { level: 2, small_blind: 50, big_blind: 100, ante: 0, duration: 10 },
    { level: 3, small_blind: 75, big_blind: 150, ante: 25, duration: 10 },
    { level: 4, small_blind: 100, big_blind: 200, ante: 25, duration: 10 },
    { is_break: true, duration: 5, label: 'Break' },
    { level: 5, small_blind: 150, big_blind: 300, ante: 50, duration: 10 },
    { level: 6, small_blind: 200, big_blind: 400, ante: 50, duration: 10 },
    { level: 7, small_blind: 300, big_blind: 600, ante: 75, duration: 10 },
    { level: 8, small_blind: 400, big_blind: 800, ante: 100, duration: 10 },
    { is_break: true, duration: 5, label: 'Break' },
    { level: 9, small_blind: 500, big_blind: 1000, ante: 100, duration: 8 },
    { level: 10, small_blind: 600, big_blind: 1200, ante: 200, duration: 8 },
    { level: 11, small_blind: 800, big_blind: 1600, ante: 200, duration: 8 },
    { level: 12, small_blind: 1000, big_blind: 2000, ante: 300, duration: 8 },
];

// ═══════════════════════════════════════════════
// TEMPLATE 7: Progressive Knockout (PKO)
// $200+$30 | 15,000 chips | 20-min levels | ~5 hrs
// Half buy-in starts as bounty, grows when you eliminate
// ═══════════════════════════════════════════════
const PKO_BLINDS = [
    { level: 1, small_blind: 50, big_blind: 100, ante: 0, duration: 20 },
    { level: 2, small_blind: 75, big_blind: 150, ante: 0, duration: 20 },
    { level: 3, small_blind: 100, big_blind: 200, ante: 25, duration: 20 },
    { level: 4, small_blind: 150, big_blind: 300, ante: 50, duration: 20 },
    { is_break: true, duration: 10, label: 'Break' },
    { level: 5, small_blind: 200, big_blind: 400, ante: 50, duration: 20 },
    { level: 6, small_blind: 250, big_blind: 500, ante: 75, duration: 20 },
    { level: 7, small_blind: 300, big_blind: 600, ante: 100, duration: 20 },
    { level: 8, small_blind: 400, big_blind: 800, ante: 100, duration: 20 },
    { is_break: true, duration: 15, label: 'Break + Color Up' },
    { level: 9, small_blind: 500, big_blind: 1000, ante: 150, duration: 20 },
    { level: 10, small_blind: 600, big_blind: 1200, ante: 200, duration: 20 },
    { level: 11, small_blind: 800, big_blind: 1600, ante: 200, duration: 15 },
    { level: 12, small_blind: 1000, big_blind: 2000, ante: 300, duration: 15 },
    { is_break: true, duration: 10, label: 'Break' },
    { level: 13, small_blind: 1500, big_blind: 3000, ante: 400, duration: 15 },
    { level: 14, small_blind: 2000, big_blind: 4000, ante: 500, duration: 15 },
    { level: 15, small_blind: 2500, big_blind: 5000, ante: 500, duration: 15 },
    { level: 16, small_blind: 3000, big_blind: 6000, ante: 1000, duration: 15 },
    { level: 17, small_blind: 4000, big_blind: 8000, ante: 1000, duration: 15 },
];

// ═══════════════════════════════════════════════
// TOURNAMENT TEMPLATES ARRAY
// ═══════════════════════════════════════════════
export const TOURNAMENT_TEMPLATES = [
    {
        id: 'daily-deepstack',
        name: 'Daily Deepstack',
        description: 'Standard Daily Tournament with Deep Starting Stack and 20-minute Levels. Great for Regulars Seeking Solid Play.',
        tournament_type: 'freezeout',
        buyin_amount: 150,
        buyin_fee: 30,
        starting_chips: 20000,
        blind_structure: DAILY_DEEPSTACK_BLINDS,
        late_registration_levels: 8,
        estimated_duration: '~5 hours',
        allows_rebuys: false,
        allows_addon: false,
        bounty_amount: 0,
        icon: 'Trophy',
        color: '#22D3EE',
    },
    {
        id: 'nightly-turbo',
        name: 'Nightly Turbo',
        description: 'Fast-paced Action with Shorter Levels. Perfect for Weeknight Play When Players Want Quick Results.',
        tournament_type: 'freezeout',
        buyin_amount: 80,
        buyin_fee: 15,
        starting_chips: 10000,
        blind_structure: NIGHTLY_TURBO_BLINDS,
        late_registration_levels: 6,
        estimated_duration: '~3 hours',
        allows_rebuys: false,
        allows_addon: false,
        bounty_amount: 0,
        icon: 'Zap',
        color: '#F59E0B',
    },
    {
        id: 'weekend-major',
        name: 'Weekend Major',
        description: 'Premium Event with Deep Stack, Long Levels, and Dinner Break. the Flagship Weekend Tournament.',
        tournament_type: 'freezeout',
        buyin_amount: 300,
        buyin_fee: 50,
        starting_chips: 30000,
        blind_structure: WEEKEND_MAJOR_BLINDS,
        late_registration_levels: 8,
        estimated_duration: '~8 hours',
        allows_rebuys: false,
        allows_addon: false,
        bounty_amount: 0,
        icon: 'Crown',
        color: '#A855F7',
    },
    {
        id: 'bounty-hunter',
        name: 'Bounty Hunter',
        description: 'Knockout Format with $50 Bounty per Elimination. Rewards Aggressive Play and Creates Action.',
        tournament_type: 'bounty',
        buyin_amount: 100,
        buyin_fee: 20,
        starting_chips: 15000,
        blind_structure: BOUNTY_HUNTER_BLINDS,
        late_registration_levels: 6,
        estimated_duration: '~4 hours',
        allows_rebuys: false,
        allows_addon: false,
        bounty_amount: 50,
        icon: 'Target',
        color: '#EF4444',
    },
    {
        id: 'rebuy-madness',
        name: 'Rebuy Madness',
        description: 'Unlimited Rebuys Through Level 6 with Add-on at Break. Builds Big Prize Pools From Smaller Buy-ins.',
        tournament_type: 'rebuy',
        buyin_amount: 60,
        buyin_fee: 10,
        starting_chips: 8000,
        blind_structure: REBUY_MADNESS_BLINDS,
        late_registration_levels: 6,
        estimated_duration: '~4 hours',
        allows_rebuys: true,
        rebuy_amount: 60,
        rebuy_chips: 8000,
        max_rebuys: 99,
        rebuy_end_level: 6,
        allows_addon: true,
        addon_amount: 60,
        addon_chips: 12000,
        addon_at_break: 2,
        bounty_amount: 0,
        icon: 'RefreshCw',
        color: '#10B981',
    },
    {
        id: 'satellite-qualifier',
        name: 'Satellite Qualifier',
        description: 'Quick Single-table Satellite with Hyper-turbo Levels. Winners Earn Seats Into Larger Events.',
        tournament_type: 'satellite',
        buyin_amount: 50,
        buyin_fee: 10,
        starting_chips: 5000,
        blind_structure: SATELLITE_QUALIFIER_BLINDS,
        late_registration_levels: 4,
        estimated_duration: '~2 hours',
        allows_rebuys: false,
        allows_addon: false,
        bounty_amount: 0,
        icon: 'Rocket',
        color: '#3B82F6',
    },
    {
        id: 'progressive-knockout',
        name: 'Progressive Knockout',
        description: 'Half the Buy-in Starts as Your Bounty. Eliminate a Player and Win Half Their Bounty — the Other Half Adds to Yours. Bounties Grow as the Tournament Progresses.',
        tournament_type: 'pko',
        buyin_amount: 200,
        buyin_fee: 30,
        starting_chips: 15000,
        blind_structure: PKO_BLINDS,
        late_registration_levels: 8,
        estimated_duration: '~5 hours',
        allows_rebuys: false,
        allows_addon: false,
        bounty_amount: 100,
        is_progressive_knockout: true,
        icon: 'Crosshair',
        color: '#F97316',
    },
];

// All supported tournament types
export const TOURNAMENT_TYPES = [
    { value: 'freezeout', label: 'Freezeout', description: 'One Buy-in, no Rebuys' },
    { value: 'rebuy', label: 'Rebuy', description: 'Rebuys Allowed During Rebuy Period' },
    { value: 'bounty', label: 'Bounty', description: 'Fixed Cash Bounty for Each Elimination' },
    { value: 'pko', label: 'Progressive KO', description: 'Bounty Grows — Half on Knock Out, Half Added to Yours' },
    { value: 'satellite', label: 'Satellite', description: 'Win a Seat to a Larger Event' },
    { value: 'shootout', label: 'Shootout', description: 'Win Your Table to Advance' },
    { value: 'turbo', label: 'Turbo', description: 'Shorter Blind Levels (8-12 Min)' },
    { value: 'hyper', label: 'Hyper-Turbo', description: 'Very Short Levels (3-5 Min)' },
];

// Common starting chip options
export const COMMON_CHIP_STACKS = [5000, 8000, 10000, 15000, 20000, 25000, 30000, 50000];

// Common buy-in amounts
export const COMMON_BUYINS = [30, 50, 60, 80, 100, 150, 200, 300, 500, 1000];

// Estimate tournament duration from blind structure
export function estimateDuration(blindStructure) {
    if (!blindStructure?.length) return 'Unknown';
    const totalMinutes = blindStructure.reduce((sum, level) => sum + (level.duration || 0), 0);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `~${mins} min`;
    if (mins === 0) return `~${hours} hrs`;
    return `~${hours}h ${mins}m`;
}

// Format buy-in display
export function formatBuyin(buyin, fee, bounty) {
    let str = `$${buyin}`;
    if (fee) str += `+$${fee}`;
    if (bounty) str += ` (+$${bounty} bounty)`;
    return str;
}

// Format chip count
export function formatChips(chips) {
    if (chips >= 1000) return `${(chips / 1000).toFixed(chips % 1000 === 0 ? 0 : 1)}K`;
    return chips.toString();
}
