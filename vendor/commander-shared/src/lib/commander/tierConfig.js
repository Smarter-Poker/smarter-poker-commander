/**
 * Commander Tier Configuration - Single Source of Truth
 * ═══════════════════════════════════════════════════════
 * Defines features, nav permissions, and limits for each tier.
 * Used by both frontend (sidebar gating) and backend (API gating).
 */

// ─────────────────────────────────────────────────────────────────────
// TEMPORARY PROMOTIONAL FLAG
// All Commander tiers (Home Game, Charity, Club) are FREE while this
// flag is true. Users still must go through the Commander sign-up /
// activation flow to access Commander features - only billing is
// waived. Flip this to `false` when pricing goes live; all pricing UI
// and the server-side create-subscription endpoint will switch back to
// the tier prices defined in TIERS below.
// ─────────────────────────────────────────────────────────────────────
export const COMMANDER_FREE_MODE = true;
export const COMMANDER_FREE_TAGLINE = 'Free While In Beta';
export const COMMANDER_FREE_SUBTEXT = 'No credit card required';

/**
 * UI helper - returns the string to display for a tier's price.
 * Returns 'Free' for every tier while COMMANDER_FREE_MODE is true.
 */
export function displayTierPrice(tier) {
    if (COMMANDER_FREE_MODE) return 'Free';
    const t = TIERS[normalizeTier(tier)];
    return t ? `$${t.price}` : '';
}

/**
 * UI helper - returns the period suffix (e.g. '/month') for a tier.
 * Returns empty string in free mode so UI shows just 'Free' without
 * an awkward '/month' after it.
 */
export function displayTierPeriod(tier) {
    if (COMMANDER_FREE_MODE) return '';
    return '/month';
}

/**
 * UI helper - returns the trial-style tagline for a tier.
 * Replaces '14-Day Free Trial' messaging while in free mode.
 */
export function displayTierTrialTagline() {
    return COMMANDER_FREE_MODE ? COMMANDER_FREE_TAGLINE : '14-Day Free Trial';
}

export const TIER_NAMES = {
    HOME_GAME: 'home_game',
    CHARITY: 'charity',
    CLUB: 'club',
    ENTERPRISE: 'enterprise', // alias → treated as 'club'
};

/**
 * Normalize tier names - maps unknown/legacy tiers to valid ones.
 * 'enterprise' and any unrecognized tier get mapped to 'club' (highest).
 */
export function normalizeTier(tier) {
    if (!tier) return TIER_NAMES.HOME_GAME;
    if (TIERS[tier]) return tier;
    // Enterprise, pro, premium, etc. → treat as club (highest tier)
    if (tier === 'enterprise' || tier === 'pro' || tier === 'premium') return TIER_NAMES.CLUB;
    return TIER_NAMES.HOME_GAME; // unknown defaults to lowest
}

/**
 * Tier definitions with pricing, limits, and feature flags
 */
export const TIERS = {
    [TIER_NAMES.HOME_GAME]: {
        name: 'Home Game',
        price: 99,
        description: 'Perfect for Home Games and Small Private Events',
        maxTables: 5,
        maxStaff: 3,
        maxSmsPerMonth: 100,
        features: {
            // Core - all tiers
            club_page: true,
            waitlist: true,
            tournaments: true,
            members_free: true,       // Free memberships / player cards
            basic_analytics: true,
            open_cash_game: true,
            tables: true,
            qr_code: true,
            settings: true,
            // Operations - charity + club only
            floor_map: false,
            floor_calls: false,
            dealers: false,
            dealer_rotation: false,
            kiosk: false,
            comps: false,
            promotions: false,
            staff_schedule: false,
            tv_displays: false,
            activity_feed: false,
            reports: false,
            incidents: false,
            close_day: false,
            member_import: false,
            advanced_analytics: false,
            // Texas Revenue - club only
            paid_memberships: false,
            time_billing: false,
            membership_plans: false,
        },
        stripePriceEnv: 'STRIPE_HOME_GAME_PRICE_ID',
    },

    [TIER_NAMES.CHARITY]: {
        name: 'Charity',
        price: 199,
        description: 'Full Operations Suite for Charity Poker Rooms',
        maxTables: 15,
        maxStaff: 10,
        maxSmsPerMonth: 500,
        features: {
            // Core - all tiers
            club_page: true,
            waitlist: true,
            tournaments: true,
            members_free: true,
            basic_analytics: true,
            open_cash_game: true,
            tables: true,
            qr_code: true,
            settings: true,
            // Operations - charity + club
            floor_map: true,
            floor_calls: true,
            dealers: true,
            dealer_rotation: true,
            kiosk: true,
            comps: true,
            promotions: true,
            staff_schedule: true,
            tv_displays: true,
            activity_feed: true,
            reports: true,
            incidents: true,
            close_day: true,
            member_import: true,
            advanced_analytics: true,
            // Texas Revenue - club only
            paid_memberships: false,
            time_billing: false,
            membership_plans: false,
        },
        stripePriceEnv: 'STRIPE_CHARITY_PRICE_ID',
    },

    [TIER_NAMES.CLUB]: {
        name: 'Club',
        price: 399,
        description: 'Full Texas-style Card Room with Paid Memberships & Seat Billing',
        maxTables: 999,
        maxStaff: 999,
        maxSmsPerMonth: 99999,
        features: {
            // Core - all tiers
            club_page: true,
            waitlist: true,
            tournaments: true,
            members_free: true,
            basic_analytics: true,
            open_cash_game: true,
            tables: true,
            qr_code: true,
            settings: true,
            // Operations - charity + club
            floor_map: true,
            floor_calls: true,
            dealers: true,
            dealer_rotation: true,
            kiosk: true,
            comps: true,
            promotions: true,
            staff_schedule: true,
            tv_displays: true,
            activity_feed: true,
            reports: true,
            incidents: true,
            close_day: true,
            member_import: true,
            advanced_analytics: true,
            // Texas Revenue - club only
            paid_memberships: true,
            time_billing: true,
            membership_plans: true,
        },
        stripePriceEnv: 'STRIPE_CLUB_PRICE_ID',
    },
};

/**
 * Map nav routes → required feature keys
 * If a route is not listed, it's allowed for all tiers.
 */
export const NAV_ROUTE_FEATURES = {
    // ── Always allowed ──
    '/commander/dashboard': null,
    '/commander/settings': null,
    '/commander/qr-code': null,

    // ── WAITLIST CARD ── (home_game core)
    '/commander/waitlist/desk': 'waitlist',
    '/commander/members': 'members_free',
    '/commander/kiosk': 'kiosk',                      // charity+
    '/commander/member-import': 'member_import',       // charity+
    '/commander/membership-plans': 'membership_plans', // club only
    '/commander/displays/waitlist': 'tv_displays',     // charity+

    // ── TOURNAMENTS CARD ── (home_game core)
    '/commander/tournaments': 'tournaments',
    '/commander/reports/tournament-results': 'reports', // charity+
    '/commander/leagues': 'tournaments',
    '/commander/tournament-controls': 'tournaments',
    '/commander/tournament-settings': 'tournaments',
    '/commander/tournament-clocks': 'tournaments',
    '/commander/clock-setup': 'tournaments',
    '/commander/tournament-maintenance': 'tournaments',

    // ── TABLES & FLOOR CARD ──
    '/commander/tables': 'tables',
    '/commander/table-assignments': 'floor_map',       // charity+
    '/commander/floor': 'floor_map',                   // charity+
    '/commander/open-game': 'open_cash_game',
    '/commander/must-move': 'floor_map',               // charity+
    '/commander/floor-calls': 'floor_calls',           // charity+
    '/commander/dealers': 'dealers',                   // charity+
    '/commander/dealer-rotation': 'dealer_rotation',   // charity+
    '/commander/table-vibes': 'tables',

    // ── STAFF & OPERATIONS CARD ──
    '/commander/staff': 'staff_schedule',               // charity+
    '/commander/poker-room': 'staff_schedule',          // charity+
    '/commander/schedule': 'staff_schedule',             // charity+
    '/commander/shift-handoff': 'staff_schedule',        // charity+
    '/commander/cashier': 'reports',                     // charity+
    '/commander/time-billing': 'time_billing',           // club only
    '/commander/incidents': 'incidents',                 // charity+
    '/commander/room-presets': 'settings',
    '/commander/game-types': 'settings',

    // ── DISPLAYS & PROMOTIONS CARD ──
    '/commander/displays': 'tv_displays',               // charity+
    '/commander/displays/tables': 'tv_displays',
    '/commander/displays/dealers': 'tv_displays',
    '/commander/displays/announcements': 'tv_displays',
    '/commander/displays/promotions': 'tv_displays',
    '/commander/displays/leaderboard': 'tv_displays',
    '/commander/displays/combined': 'tv_displays',
    '/commander/streaming': 'tv_displays',              // charity+
    '/commander/notifications': 'promotions',            // charity+
    '/commander/promotions': 'promotions',               // charity+
    '/commander/comps': 'comps',                         // charity+
    '/commander/high-hands': 'promotions',               // charity+

    // ── REPORTS & SYSTEM CARD ──
    '/commander/reports': 'reports',                     // charity+
    '/commander/reports/daily-summary': 'reports',
    '/commander/reports/revenue': 'reports',
    '/commander/reports/staff-activity': 'reports',
    '/commander/reports/player-activity': 'reports',
    '/commander/analytics': 'advanced_analytics',        // charity+
    '/commander/reports/analytics-daily': 'advanced_analytics',
    '/commander/reports/table-utilization': 'reports',
    '/commander/reports/waitlist-metrics': 'reports',
    '/commander/reports/tax-compliance': 'reports',
    '/commander/activity': 'activity_feed',              // charity+
    '/commander/churn-prediction': 'advanced_analytics', // charity+
    '/commander/close-day': 'close_day',                // charity+
    '/commander/system-info': null,                      // always allowed
    '/commander/exports': 'reports',                     // charity+
    '/commander/downloads': null,                        // always allowed
    '/commander/responsible-gaming': null,                // always allowed
    '/commander/marketplace': null,                      // always allowed
    '/commander/reputation': null,                       // always allowed
};

/**
 * Check if a feature is available for a given tier
 * @param {string} tier - 'home_game', 'charity', or 'club'
 * @param {string} featureKey - feature key from the features object
 * @returns {boolean}
 */
export function hasFeature(tier, featureKey) {
    const normalized = normalizeTier(tier);
    const tierConfig = TIERS[normalized];
    if (!tierConfig) return false;
    if (!featureKey) return true; // null featureKey = allowed for all
    return !!tierConfig.features[featureKey];
}

/**
 * Check if a route is accessible for a given tier
 * @param {string} tier - 'home_game', 'charity', or 'club'
 * @param {string} route - the nav route path
 * @returns {boolean}
 */
export function canAccessRoute(tier, route) {
    const featureKey = NAV_ROUTE_FEATURES[route];
    return hasFeature(tier, featureKey);
}

/**
 * Get the tier config object
 * @param {string} tier - 'home_game', 'charity', or 'club'
 * @returns {object|null}
 */
export function getTierConfig(tier) {
    const normalized = normalizeTier(tier);
    return TIERS[normalized] || null;
}

/**
 * Get the minimum tier required for a feature
 * Returns the cheapest tier that includes the feature
 */
export function getMinimumTier(featureKey) {
    const tierOrder = [TIER_NAMES.HOME_GAME, TIER_NAMES.CHARITY, TIER_NAMES.CLUB];
    for (const tier of tierOrder) {
        if (TIERS[tier].features[featureKey]) return tier;
    }
    return null;
}

/**
 * Get the upgrade target for a given tier
 */
export function getUpgradeTier(currentTier) {
    const normalized = normalizeTier(currentTier);
    if (normalized === TIER_NAMES.HOME_GAME) return TIER_NAMES.CHARITY;
    if (normalized === TIER_NAMES.CHARITY) return TIER_NAMES.CLUB;
    return null; // Already on highest tier (club/enterprise)
}
