/**
 * PER-GAME GATE LOGIC
 * Handles diamond deduction per game start + one-time popup dismissal
 * Used by trivia, training, memory games, and GTO trainer
 */

import { supabase } from '../supabase';

/** Default per-game diamond cost */
export const GAME_COST = 10;

/**
 * Check if the one-time cost popup has been dismissed for a page
 * Checks localStorage first, then Supabase for cross-device persistence
 */
export async function checkPopupDismissed(userId, pageKey) {
    // Fast path: check localStorage
    const localKey = `sp-game-popup-${pageKey}`;
    if (typeof window !== 'undefined' && localStorage.getItem(localKey) === 'dismissed') {
        return true;
    }

    // If user is logged in, check Supabase
    if (userId) {
        try {
            const { data } = await supabase
                .from('vip_feature_dismissals')
                .select('id')
                .eq('user_id', userId)
                .eq('feature_key', `game_cost_popup_${pageKey}`)
                .maybeSingle();

            if (data) {
                // Sync to localStorage for faster checks
                if (typeof window !== 'undefined') {
                    localStorage.setItem(localKey, 'dismissed');
                }
                return true;
            }
        } catch {
            // Table might not exist yet, fall through
        }
    }

    return false;
}

/**
 * Persist popup dismissal (localStorage + Supabase)
 */
export async function dismissPopup(userId, pageKey) {
    const localKey = `sp-game-popup-${pageKey}`;

    // Always set localStorage
    if (typeof window !== 'undefined') {
        localStorage.setItem(localKey, 'dismissed');
    }

    // Persist to Supabase if logged in
    if (userId) {
        try {
            await supabase
                .from('vip_feature_dismissals')
                .upsert({
                    user_id: userId,
                    feature_key: `game_cost_popup_${pageKey}`,
                    dismissed_at: new Date().toISOString()
                }, {
                    onConflict: 'user_id,feature_key'
                });
        } catch {
            // Non-critical, localStorage is the primary store
        }
    }
}
