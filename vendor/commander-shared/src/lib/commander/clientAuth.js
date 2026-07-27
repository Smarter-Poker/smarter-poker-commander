/**
 * Commander Client-Side Auth Helpers
 * Centralized helpers for reading auth tokens & staff session from localStorage.
 * Used by Commander page components for API calls.
 *
 * Previously these 3-line helpers were copy-pasted into 41+ pages.
 * Import from here instead of re-declaring them in every file.
 *
 * Usage (from pages or other components):
 *   import { getToken, getStaffSession, getAuthHeaders } from '@/lib/commander/clientAuth';
 */

/**
 * Get the current access token from localStorage.
 * Checks multiple storage locations:
 *   1. commander_token (legacy PIN-based login key — may not be set)
 *   2. smarter-poker-auth (unified auth key)
 *   3. sb-<project>-auth-token (Supabase default storage — JSON blob with access_token)
 * Returns the raw JWT access token string, or '' if none found.
 */
export function getToken() {
    if (typeof window === 'undefined') return '';
    try {
        // 1. Legacy key (may be set by some flows)
        const legacy = localStorage.getItem('commander_token');
        if (legacy) return legacy;

        // 2. Unified auth key
        const unified = localStorage.getItem('smarter-poker-auth');
        if (unified) {
            try { const p = JSON.parse(unified); if (p?.access_token) return p.access_token; } catch (e) { console.warn('[App] Handled exception:', e); }
        }

        // 3. Supabase default storage: sb-<projectRef>-auth-token (JSON with access_token)
        const sbKeys = Object.keys(localStorage || {}).filter(
            k => k.startsWith('sb-') && k.endsWith('-auth-token')
        );
        if (sbKeys.length > 0) {
            const raw = localStorage.getItem(sbKeys[0]);
            if (raw) {
                try { const p = JSON.parse(raw); if (p?.access_token) return p.access_token; } catch (e) { console.warn('[App] Handled exception:', e); }
            }
        }
    } catch (e) { console.warn('[App] Handled exception:', e); }
    return '';
}

/**
 * Get the staff session JSON string from localStorage.
 * This is passed as the `x-staff-session` header for API calls requiring staff auth.
 */
export function getStaffSession() {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('commander_staff') || '';
}

/**
 * Get a complete headers object for authenticated Commander API calls.
 * Combines the Bearer token + staff session header.
 */
export function getAuthHeaders() {
    return {
        Authorization: `Bearer ${getToken()}`,
        'x-staff-session': getStaffSession(),
    };
}

/**
 * Get the parsed staff session object. Returns {} if not found or invalid.
 */
export function getStaffData() {
    try {
        return JSON.parse(getStaffSession() || '{}');
    } catch {
        return {};
    }
}

/**
 * Get the venue_id from the staff session.
 */
export function getVenueId() {
    return getStaffData().venue_id || null;
}
