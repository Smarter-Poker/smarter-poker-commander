/**
 * Get auth token from localStorage with fallback for legacy sessions
 * 
 * Checks smarter-poker-auth first (new), then falls back to sb-*-auth-token (legacy)
 * This ensures backwards compatibility for users who signed up before the auth key change.
 */
export function getAuthToken() {
    if (typeof window === 'undefined') return null;

    try {
        // PRIMARY: Check new unified key
        let token = localStorage.getItem('smarter-poker-auth');

        // FALLBACK: Legacy sb-* keys for older users
        if (!token) {
            const sbKeys = Object.keys(localStorage || {}).filter(
                k => k.startsWith('sb-') && k.endsWith('-auth-token')
            );
            if (sbKeys.length > 0) token = localStorage.getItem(sbKeys[0]);
        }

        return token;
    } catch (e) {
        console.warn('[getAuthToken] Error reading localStorage:', e);
        return null;
    }
}

/**
 * Get parsed auth data with user object
 * Returns { user, access_token, refresh_token } or null
 */
export function getAuthData() {
    const token = getAuthToken();
    if (!token) return null;

    try {
        return JSON.parse(token);
    } catch (e) {
        console.warn('[getAuthData] Error parsing token:', e);
        return null;
    }
}

/**
 * Get current user from localStorage auth
 * Returns user object or null
 */
export function getAuthUser() {
    const data = getAuthData();
    return data?.user || null;
}
