/**
 * GENERIC PREMIUM FEATURE GATE
 * Reusable day-pass access gate logic for any feature
 * Adapted from bankroll/premiumFeatureGate.js to support any feature_key and cost
 */

import { supabase } from '../supabase';
import { busEmit } from '../../engine/EventBus';

/**
 * Check if user has access to a premium feature
 * @param {string} userId - User UUID
 * @param {string} featureKey - Feature identifier (e.g., 'bankroll_pro', 'poker_near_me', 'personal_assistant')
 * @returns {Promise<{hasAccess: boolean, isVip: boolean, expiresAt: Date|null, diamonds: number}>}
 */
export async function checkFeatureAccess(userId, featureKey) {
    if (!userId) return { hasAccess: false, isVip: false, expiresAt: null, diamonds: 0 };

    // ═══════════════════════════════════════════════════════════════════
    // VIP DEFENSE LAYER 0: Check localStorage cache BEFORE any network
    // This prevents VIP lockouts if network is slow/down
    // ═══════════════════════════════════════════════════════════════════
    if (typeof window !== 'undefined') {
        try {
            if (localStorage.getItem('sp-vip-status') === 'true') {
                console.debug('[FeatureGate] VIP confirmed via localStorage cache — skipping network check');
                return { hasAccess: true, isVip: true, expiresAt: null, diamonds: 0 };
            }
        } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    }

    // Ensure Supabase session is ready before querying
    let sessionUserId = null;
    try {
        const session = { access_token: JSON.parse(localStorage.getItem('smarter-poker-auth') || '{}').access_token };
        sessionUserId = session?.user?.id;
        if (!sessionUserId) {
            console.warn('[FeatureGate] No active Supabase session — waiting for auth...');
            // Wait briefly for session to establish (common on page load)
            await new Promise(r => setTimeout(r, 500));
            const retrySession = { access_token: JSON.parse(localStorage.getItem('smarter-poker-auth') || '{}').access_token };
            sessionUserId = retrySession?.user?.id;
        }
    } catch (e) {
        console.warn('[FeatureGate] Session check failed:', e);
    }

    // Fetch profile with error handling + retry
    let profile = null;
    let fetchError = null;

    const fetchProfile = async () => {
        const { data, error } = await supabase
            .from('profiles')
            .select('is_vip, diamonds')
            .eq('id', userId)
            .maybeSingle();
        if (error) {
            console.warn('[FeatureGate] Profile fetch error:', error.message, '| userId:', userId);
            return { data: null, error };
        }
        return { data, error: null };
    };

    // First attempt
    const result1 = await fetchProfile();
    if (result1.data) {
        profile = result1.data;
    } else {
        // Retry once after a short delay (auth may have just initialized)
        console.warn('[FeatureGate] Retrying profile fetch after 1s delay...');
        await new Promise(r => setTimeout(r, 1000));
        const result2 = await fetchProfile();
        if (result2.data) {
            profile = result2.data;
        } else {
            fetchError = result2.error;
        }
    }

    // If profile fetch totally failed, try server-side VIP bridge as last resort
    if (!profile) {
        console.warn('[FeatureGate] CRITICAL: Could not fetch profile for userId:', userId, '| Error:', fetchError?.message);
        // ═══════════════════════════════════════════════════════════════════
        // HARDENED: Server-side fallback via /api/vip/check-status
        // Uses Supabase service role key (bypasses RLS) — will succeed even
        // when client-side auth/session is not ready
        // ═══════════════════════════════════════════════════════════════════
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            // Try to include session token for authenticated call
            const headers = {};
            try {
                const session = { access_token: JSON.parse(localStorage.getItem('smarter-poker-auth') || '{}').access_token };
                if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
            } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }
            const resp = await fetch(`/api/vip/check-status?userId=${userId}`, { signal: controller.signal, headers });
            clearTimeout(timeoutId);
            if (resp.ok) {
                const vipData = await resp.json();
                if (vipData.isVip) {
                    console.debug('[FeatureGate] Server-side fallback confirmed VIP for userId:', userId);
                    return { hasAccess: true, isVip: true, expiresAt: null, diamonds: vipData.diamonds || 0 };
                }
            }
        } catch (fallbackErr) {
            console.warn('[FeatureGate] Server-side VIP fallback also failed:', fallbackErr.message);
        }
        return { hasAccess: false, isVip: false, expiresAt: null, diamonds: 0, error: 'Profile fetch failed' };
    }

    console.debug('[FeatureGate] Profile loaded — diamonds:', profile.diamonds, '| is_vip:', profile.is_vip);

    // VIP users get unlimited access
    if (profile.is_vip) {
        // Sync VIP status to localStorage for optimistic rendering
        if (typeof window !== 'undefined') {
            try { localStorage.setItem('sp-vip-status', 'true'); } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }
        }
        return { hasAccess: true, isVip: true, expiresAt: null, diamonds: profile.diamonds || 0 };
    }

    const now = new Date().toISOString();

    // ═══════════════════════════════════════════════════════════════════
    // DAILY UNLOCK ALL: Check for active universal day pass (150 💎)
    // This grants access to ALL gated features for 24 hours
    // ═══════════════════════════════════════════════════════════════════
    const { data: universalPass, error: universalError } = await supabase
        .from('premium_feature_access')
        .select('expires_at')
        .eq('user_id', userId)
        .eq('feature_key', 'daily_unlock_all')
        .gt('expires_at', now)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (universalError) {
        console.warn('[FeatureGate] Universal pass check error:', universalError.message);
    }

    if (universalPass) {
        return {
            hasAccess: true,
            isVip: false,
            isDailyUnlock: true,
            expiresAt: new Date(universalPass.expires_at),
            diamonds: profile.diamonds || 0
        };
    }

    // Check for active individual feature day pass
    const { data: access, error: accessError } = await supabase
        .from('premium_feature_access')
        .select('expires_at')
        .eq('user_id', userId)
        .eq('feature_key', featureKey)
        .gt('expires_at', now)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (accessError) {
        console.warn('[FeatureGate] Access check error:', accessError.message);
    }

    if (access) {
        return {
            hasAccess: true,
            isVip: false,
            expiresAt: new Date(access.expires_at),
            diamonds: profile.diamonds || 0
        };
    }

    return {
        hasAccess: false,
        isVip: false,
        expiresAt: null,
        diamonds: profile.diamonds || 0
    };
}

/**
 * Purchase day-pass access to a premium feature
 * @param {string} userId - User UUID
 * @param {string} featureKey - Feature identifier
 * @param {number} cost - Diamond cost
 * @param {number} durationHours - Access duration in hours (default 24)
 * @param {string} description - Human-readable description for transaction log
 * @returns {Promise<{success: boolean, expiresAt?: Date, newBalance?: number, error?: string}>}
 */
export async function purchaseFeatureAccess(userId, featureKey, cost, durationHours = 24, description = '') {
    // Get current balance + VIP check
    const { data: profile } = await supabase
        .from('profiles')
        .select('diamonds, is_vip')
        .eq('id', userId)
        .maybeSingle();

    // VIP users don't need to purchase
    if (profile?.is_vip) {
        return { success: true, isVip: true };
    }

    const currentBalance = profile?.diamonds || 0;
    if (currentBalance < cost) {
        return {
            success: false,
            error: 'Insufficient diamonds',
            required: cost,
            balance: currentBalance
        };
    }

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + durationHours);

    // Atomic diamond deduction via RPC (race-condition safe)
    let newBalance = currentBalance - cost;
    const { data: rpcResult, error: rpcError } = await supabase.rpc('deduct_diamonds', {
        p_user_id: userId,
        p_amount: cost,
        p_source: 'feature_unlock',
        p_metadata: { feature_key: featureKey, duration_hours: durationHours }
    });

    if (rpcError) {
        // Fallback to direct update if RPC doesn't exist
        if (rpcError.message?.includes('function') || rpcError.code === '42883') {
            const { error: directError } = await supabase.rpc('add_diamonds_to_balance', {
                p_user_id: userId,
                p_amount: -cost,
                p_type: 'feature_unlock',
                p_description: description || `${featureKey} - ${durationHours} Hour Access (fallback)`,
                p_reference_id: null
            });
            if (directError) {
                return { success: false, error: 'Failed to deduct diamonds' };
            }
        } else {
            return { success: false, error: rpcError.message || 'Failed to deduct diamonds' };
        }
    } else if (rpcResult) {
        // RPC succeeded — use authoritative balance from DB
        if (rpcResult.success === false) {
            return { success: false, error: rpcResult.error || 'Insufficient diamonds', balance: rpcResult.balance };
        }
        newBalance = rpcResult.balance ?? newBalance;
    }

    // Log transaction (skip if RPC already logged it)
    if (rpcError) {
        await supabase.from('diamond_transactions').insert({
            user_id: userId,
            amount: -cost,
            transaction_type: 'feature_unlock',
            description: description || `${featureKey} - ${durationHours} Hour Access`,
            metadata: { feature_key: featureKey, duration_hours: durationHours },
            balance_after: newBalance
        });
    }

    // Grant access
    const { error: accessError } = await supabase
        .from('premium_feature_access')
        .insert({
            user_id: userId,
            feature_key: featureKey,
            expires_at: expiresAt.toISOString(),
            diamonds_spent: cost
        });

    if (accessError) {
        // Refund on failure — award back the diamonds
        await supabase.rpc('award_diamonds', {
            p_user_id: userId,
            p_amount: cost,
            p_source: 'feature_unlock_refund',
            p_metadata: { feature_key: featureKey, reason: 'access_grant_failed' }
        }).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        return { success: false, error: 'Failed to grant access' };
    }

    // 🚌 BUS EVENT: Notify the EventBus of diamond spend + feature access change
    busEmit.diamondsSpent(cost, `${featureKey} Day Pass`);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('feature-access-changed', { detail: { featureKey } }));
    }

    return {
        success: true,
        expiresAt,
        newBalance
    };
}

/**
 * Feature configuration map
 */
export const FEATURE_CONFIG = {
    bankroll_pro: { cost: 25, label: 'Bankroll Manager Pro', durationHours: 24 },
    poker_near_me: { cost: 25, label: 'Poker Near Me Pro', durationHours: 24 },
    personal_assistant: { cost: 100, label: 'Personal Assistant', durationHours: 24 },
    lives: { cost: 25, label: 'Lives', durationHours: 24 },
    gto_training: { cost: 25, label: 'GTO Training', durationHours: 24 },
    trivia_pvp: { cost: 25, label: 'PvP Trivia Battles', durationHours: 24 },
    custom_avatar: { cost: 25, label: 'Custom Avatar Builder', durationHours: 24 },
    daily_unlock_all: { cost: 150, label: 'Daily All-Access Pass', durationHours: 24 }
};

/** Diamond cost for a 30-day VIP membership */
export const VIP_DIAMOND_COST = 1999;

/**
 * Purchase VIP membership with diamonds (30 days)
 * @param {string} userId - User UUID
 * @returns {Promise<{success: boolean, expiresAt?: Date, newBalance?: number, error?: string}>}
 */
export async function purchaseVipWithDiamonds(userId) {
    if (!userId) return { success: false, error: 'Not logged in' };

    // Check current status + balance
    const { data: profile } = await supabase
        .from('profiles')
        .select('diamonds, is_vip')
        .eq('id', userId)
        .maybeSingle();

    if (!profile) return { success: false, error: 'Profile not found' };
    if (profile.is_vip) return { success: false, error: 'Already a VIP member' };

    const currentBalance = profile.diamonds || 0;
    if (currentBalance < VIP_DIAMOND_COST) {
        return {
            success: false,
            error: 'Insufficient diamonds',
            required: VIP_DIAMOND_COST,
            balance: currentBalance
        };
    }

    // Calculate expiry (30 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Atomic diamond deduction via RPC
    let newBalance = currentBalance - VIP_DIAMOND_COST;
    const { data: rpcResult, error: rpcError } = await supabase.rpc('deduct_diamonds', {
        p_user_id: userId,
        p_amount: VIP_DIAMOND_COST,
        p_source: 'vip_membership',
        p_metadata: { type: 'diamond_vip', duration_days: 30 }
    });

    if (rpcError) {
        // Fallback to direct update if RPC doesn't exist
        if (rpcError.message?.includes('function') || rpcError.code === '42883') {
            const { error: directError } = await supabase.rpc('add_diamonds_to_balance', {
                p_user_id: userId,
                p_amount: -VIP_DIAMOND_COST,
                p_type: 'vip_membership',
                p_description: 'VIP Membership — 30 Day Diamond Purchase (fallback)',
                p_reference_id: null
            });
            if (directError) return { success: false, error: 'Failed to deduct diamonds' };
        } else {
            return { success: false, error: rpcError.message || 'Failed to deduct diamonds' };
        }
    } else if (rpcResult) {
        if (rpcResult.success === false) {
            return { success: false, error: rpcResult.error || 'Insufficient diamonds', balance: rpcResult.balance };
        }
        newBalance = rpcResult.balance ?? newBalance;
    }

    // Log transaction (skip if RPC already logged)
    if (rpcError) {
        await supabase.from('diamond_transactions').insert({
            user_id: userId,
            amount: -VIP_DIAMOND_COST,
            transaction_type: 'vip_membership',
            description: 'VIP Membership — 30 Day Diamond Purchase',
            metadata: { type: 'diamond_vip', duration_days: 30 },
            balance_after: newBalance
        });
    }

    // Activate VIP on profile
    const { error: vipError } = await supabase
        .from('profiles')
        .update({
            is_vip: true,
            vip_tier: 'monthly',
            vip_expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', userId);

    if (vipError) {
        // Refund on failure
        await supabase.rpc('award_diamonds', {
            p_user_id: userId,
            p_amount: VIP_DIAMOND_COST,
            p_source: 'vip_membership_refund',
            p_metadata: { reason: 'vip_activation_failed' }
        }).catch(() => {
            supabase.rpc('add_diamonds_to_balance', {
                p_user_id: userId,
                p_amount: VIP_DIAMOND_COST,
                p_type: 'vip_membership_refund',
                p_description: 'VIP membership refund (activation failed)',
                p_reference_id: null
            }).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        });
        return { success: false, error: 'Failed to activate VIP' };
    }

    // Record in vip_subscriptions (non-critical, ignore errors)
    await supabase.from('vip_subscriptions').upsert({
        user_id: userId,
        tier: 'monthly',
        status: 'active',
        price_usd: 0,
        current_period_start: new Date().toISOString(),
        current_period_end: expiresAt.toISOString(),
        stripe_subscription_id: `diamond_${userId}_${Date.now()}`,
        updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' }).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));

    // 🚌 BUS EVENT: Notify the EventBus of VIP diamond purchase
    busEmit.diamondsSpent(VIP_DIAMOND_COST, 'VIP Diamond Membership');
    // Update localStorage for instant UI feedback
    if (typeof window !== 'undefined') {
        localStorage.setItem('sp-vip-tier', 'monthly');
        window.dispatchEvent(new CustomEvent('vip-status-changed', { detail: { vipGranted: true } }));
    }

    return {
        success: true,
        expiresAt,
        newBalance
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY UNLOCK ALL — 150 💎 for 24-hour access to ALL pay-as-you-go features
// ═══════════════════════════════════════════════════════════════════════════════

export const DAILY_UNLOCK_ALL_COST = 150;

/**
 * Check if user has an active universal daily unlock pass
 * @param {string} userId - User UUID
 * @returns {Promise<{hasUnlock: boolean, expiresAt: Date|null}>}
 */
export async function checkDailyUnlockAll(userId) {
    if (!userId) return { hasUnlock: false, expiresAt: null };

    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('premium_feature_access')
        .select('expires_at')
        .eq('user_id', userId)
        .eq('feature_key', 'daily_unlock_all')
        .gt('expires_at', now)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.warn('[DailyUnlockAll] Check error:', error.message);
    }

    if (data) {
        return { hasUnlock: true, expiresAt: new Date(data.expires_at) };
    }

    return { hasUnlock: false, expiresAt: null };
}

/**
 * Purchase 24-hour universal unlock for ALL features (150 💎)
 * @param {string} userId - User UUID
 * @returns {Promise<{success: boolean, expiresAt?: Date, newBalance?: number, error?: string}>}
 */
export async function purchaseDailyUnlockAll(userId) {
    return purchaseFeatureAccess(
        userId,
        'daily_unlock_all',
        DAILY_UNLOCK_ALL_COST,
        24,
        'Daily All-Access Pass — 24 Hour Unlock'
    );
}
