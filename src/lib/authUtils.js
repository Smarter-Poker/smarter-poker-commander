/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GLOBAL AUTH UTILITY — Bulletproof Authentication for Smarter.Poker
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This utility provides consistent, AbortError-resistant auth methods for
 * all pages in the application. It uses localStorage for session retrieval
 * and native fetch for database queries to bypass Supabase JS client issues.
 * 
 * Usage:
 *   import { getAuthUser, fetchWithAuth, queryProfiles } from '@/lib/authUtils';
 *   
 *   // Get current user
 *   const user = getAuthUser();
 *   
 *   // Fetch data with auth
 *   const data = await fetchWithAuth('/rest/v1/profiles?id=eq.123');
 *   
 *   // Or use the typed query helpers
 *   const profile = await queryProfiles(userId);
 */

// Supabase credentials — use env vars with hardcoded fallback for production stability
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1a2xmbmFwYmttYWN2d3hrdGJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzA4NDQsImV4cCI6MjA4MzMwNjg0NH0.ZGFrUYq7yAbkveFdudh4q_Xk0qN0AZ-jnu4FkX9YKjo';

/**
 * Get the current authenticated user from localStorage
 * Uses explicit 'smarter-poker-auth' key (primary) with fallback to legacy sb-* keys
 */
export function getAuthUser() {
    if (typeof window === 'undefined') return null;

    try {
        // PRIMARY: Use explicit storage key (set in supabase.ts)
        const explicitAuth = localStorage.getItem('smarter-poker-auth');
        if (explicitAuth) {
            const tokenData = JSON.parse(explicitAuth);
            if (tokenData?.user) {
                return tokenData.user;
            }
        }

        // FALLBACK: Legacy sb-* keys (for backwards compatibility during migration)
        const sbKeys = Object.keys(localStorage || {}).filter(
            k => k.startsWith('sb-') && k.endsWith('-auth-token')
        );

        if (sbKeys.length > 0) {
            const tokenData = JSON.parse(localStorage.getItem(sbKeys[0]) || '{}');
            return tokenData?.user || null;
        }

        // FALLBACK 2: sp-cached-header-user (for UI context when tokens are missing, immune to navigator.locks AbortError)
        const cachedUserStr = localStorage.getItem('sp-cached-header-user');
        if (cachedUserStr) {
            const cachedUser = JSON.parse(cachedUserStr);
            if (cachedUser?.id) {
                return cachedUser;
            }
        }
    } catch (e) {
        console.warn('[AuthUtils] Error reading auth:', e);
    }

    return null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BULLETPROOF USER RETRIEVAL — 3-Level Fallback Chain
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * USE THIS INSTEAD OF supabase.auth.getUser() EVERYWHERE.
 * 
 * Level 1: supabase.auth.getUser() — network call (can fail with AbortError)
 * Level 2: supabase.auth.getSession() — localStorage via Supabase (can fail with navigator.locks)
 * Level 3: getAuthUser() — direct localStorage read (ALWAYS works, immune to AbortError)
 * 
 * Usage:
 *   import { getSafeUser } from '@/lib/authUtils';
 *   const user = await getSafeUser(supabase);
 *   if (!user) { // truly not logged in }
 */
export async function getSafeUser(supabaseClient) {
    // Level 1: Try supabase.auth.getUser() (network call)
    try {
        const { data: authData } = await supabaseClient.auth.getUser();
        const user = authData?.user;
        if (user) return user;
    } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }

    // Level 2: Try supabase.auth.getSession() (localStorage via Supabase)
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user) return session.user;
    } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }

    // Level 3: Direct localStorage read (NEVER fails in browser)
    try {
        const localUser = getAuthUser();
        if (localUser?.id) return localUser;
    } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }

    return null; // Truly not logged in
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RESILIENT AUTH GATE — Wait for auth before deciding to redirect
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * USE THIS for page-level auth guards. Unlike getAccessToken() which is a
 * one-shot localStorage read (races with Supabase SDK token refresh),
 * this function waits for the session to stabilize first.
 * 
 * Usage:
 *   const user = await ensureAuthReady(supabase);
 *   if (!user) router.push('/auth/login');
 */
export async function ensureAuthReady(supabaseClient) {
    // 1. Immediate localStorage check (instant, no network)
    const immediate = getAuthUser();
    if (immediate?.id) return immediate;

    // 2. Wait for Supabase SDK session resolution (handles refresh cycles)
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user) return session.user;
    } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }

    // 3. Brief wait then retry localStorage (SDK may write async after getSession resolves)
    await new Promise(r => setTimeout(r, 300));
    const retried = getAuthUser();
    if (retried?.id) return retried;

    // 4. Last resort — full getSafeUser chain (includes getUser network call)
    const safeUser = await getSafeUser(supabaseClient);
    if (safeUser?.id) return safeUser;

    // 5. Session backup recovery — restores from backup if primary was corrupted
    try {
        const restored = restoreSessionBackup();
        if (restored) {
            const backupUser = getAuthUser();
            if (backupUser?.id) {
                console.debug('[authUtils] Session recovered from backup');
                return backupUser;
            }
        }
    } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }

    return null; // Truly not logged in
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useRequireAuth() — Drop-in hook for protected pages
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Replaces the fragile pattern:
 *   const token = getAccessToken();
 *   if (!token) router.push('/auth/login');
 * 
 * With:
 *   const { user, checking } = useRequireAuth('/hub/commander/services');
 *   if (checking) return <SkeletonLoader />;
 * 
 * Features:
 *  - 5-layer auth resolution via ensureAuthReady()
 *  - sessionStorage fast-path for same-session page navigation
 *  - Cross-tab sync: auto-redirects to login if auth is cleared in another tab
 *  - Session backup on success: keeps backup fresh for recovery
 *  - Auth singleton: deduplicates concurrent ensureAuthReady() calls
 */

// Global singleton to deduplicate concurrent auth checks (#8)
let _authPromise = null;
function getAuthOnce(sb) {
    if (!_authPromise) {
        _authPromise = ensureAuthReady(sb).finally(() => { _authPromise = null; });
    }
    return _authPromise;
}

export function useRequireAuth(redirectPath) {
    const [user, setUser] = useState(null);
    const [checking, setChecking] = useState(true);
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;
        (async () => {
            // Fast-path: If auth was already confirmed this session, skip full check
            if (typeof window !== 'undefined' && sessionStorage.getItem('sp_auth_confirmed')) {
                const cached = getAuthUser();
                if (cached?.id) {
                    if (!cancelled) {
                        setUser(cached);
                        setChecking(false);
                    }
                    return;
                }
                // Cached flag exists but user is gone — clear and do full check
                sessionStorage.removeItem('sp_auth_confirmed');
            }

            // Full check with singleton deduplication (#8)
            const { supabase: sb } = await import('./supabase');
            const u = await getAuthOnce(sb);
            if (cancelled) return;
            if (!u) {
                const target = redirectPath || router.asPath;
                router.push('/auth/login?redirect=' + encodeURIComponent(target));
            } else {
                setUser(u);
                // Set fast-path flag for subsequent page loads in this session
                if (typeof window !== 'undefined') {
                    sessionStorage.setItem('sp_auth_confirmed', '1');
                }
                // Keep session backup fresh on every successful auth (#7)
                try { backupSession(); } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }
            }
            setChecking(false);
        })();
        return () => { cancelled = true; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Cross-tab auth sync: auto-redirect if auth is cleared in another tab (#1)
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleStorage = (e) => {
            if (e.key === 'smarter-poker-auth' && !e.newValue) {
                // Auth was cleared in another tab — redirect to login
                setUser(null);
                sessionStorage.removeItem('sp_auth_confirmed');
                const target = redirectPath || router.asPath;
                router.push('/auth/login?redirect=' + encodeURIComponent(target));
            }
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, [redirectPath, router]);

    return { user, checking };
}

/**
 * Get the current session token for authenticated requests
 * Uses explicit 'smarter-poker-auth' key (primary) with fallback to legacy sb-* keys
 */
export function getSessionToken() {
    if (typeof window === 'undefined') return null;

    try {
        // PRIMARY: Use explicit storage key
        const explicitAuth = localStorage.getItem('smarter-poker-auth');
        if (explicitAuth) {
            const tokenData = JSON.parse(explicitAuth);
            if (tokenData?.access_token) {
                return tokenData.access_token;
            }
        }

        // FALLBACK: Legacy sb-* keys
        const sbKeys = Object.keys(localStorage || {}).filter(
            k => k.startsWith('sb-') && k.endsWith('-auth-token')
        );

        if (sbKeys.length > 0) {
            const tokenData = JSON.parse(localStorage.getItem(sbKeys[0]) || '{}');
            return tokenData?.access_token || null;
        }
    } catch (e) {
        console.warn('[AuthUtils] Error reading token:', e);
    }

    return null;
}

/**
 * Get the access token for authenticated API calls.
 * Alias for getSessionToken — matches the .ts file export name
 * Both files must export this for dynamic import() consistency.
 */
export function getAccessToken() {
    return getSessionToken();
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * authedFetch — Drop-in replacement for fetch() that auto-injects Bearer token
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * USE THIS for internal /api/ route calls instead of raw fetch().
 * Automatically adds Authorization header from getAccessToken().
 * On 401, clears fast-path cache so next page load does full auth check.
 * 
 * Usage:
 *   import { authedFetch } from '@/lib/authUtils';
 *   const res = await authedFetch('/api/training/save-session', {
 *       method: 'POST',
 *       body: JSON.stringify({ gameId: 'foo', ... })
 *   });
 */
export async function authedFetch(url, options = {}) {
    const token = getAccessToken();
    const headers = {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    // Auto-add Content-Type for JSON bodies if not already set
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, { ...options, headers });

    // On 401, attempt silent token refresh and retry ONCE
    if (response.status === 401 && token) {
        try {
            const { supabase: sb } = await import('./supabase');
            const { data } = await sb.auth.refreshSession();
            if (data?.session?.access_token) {
                // Retry with fresh token
                const retryHeaders = {
                    ...(options.headers || {}),
                    Authorization: `Bearer ${data.session.access_token}`,
                };
                if (options.body && typeof options.body === 'string' && !retryHeaders['Content-Type']) {
                    retryHeaders['Content-Type'] = 'application/json';
                }
                const retryResponse = await fetch(url, { ...options, headers: retryHeaders });
                if (retryResponse.status !== 401) {
                    return retryResponse; // Refresh worked
                }
            }
        } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }

        // Refresh didn't help — clear fast-path so next page does full auth
        try { sessionStorage.removeItem('sp_auth_confirmed'); } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }
        console.warn(`[authedFetch] 401 on ${url} — token refresh failed`);
    }

    return response;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * createAuthedFetcher — SWR-compatible fetcher with auto auth
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Drop-in replacement for SWR's default fetcher. Auto-adds Bearer token.
 * 
 * Usage:
 *   import { createAuthedFetcher } from '@/lib/authUtils';
 *   const { data } = useSWR('/api/training/challenges', createAuthedFetcher());
 * 
 * Or for JSON parsing:
 *   const fetcher = createAuthedFetcher();
 *   const { data } = useSWR(key, fetcher);
 */
export function createAuthedFetcher() {
    return async (url) => {
        const res = await authedFetch(url);
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return res.json();
    };
}


/**
 * Fetch data from Supabase REST API with authentication
 * Bypasses supabase-js client to avoid AbortError
 */
export async function fetchWithAuth(endpoint, options = {}) {
    const sessionToken = getSessionToken();
    const authToken = sessionToken || SUPABASE_ANON_KEY;

    const url = endpoint.startsWith('http') ? endpoint : `${SUPABASE_URL}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            'Prefer': options.prefer || 'return=representation',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`HTTP ${response.status}: ${error}`);
    }

    return response.json();
}

/**
 * Query profiles table
 */
export async function queryProfiles(userId, select = '*') {
    const data = await fetchWithAuth(
        `/rest/v1/profiles?id=eq.${userId}&select=${encodeURIComponent(select)}`
    );
    return data[0] || null;
}

/**
 * Query user diamond balance from user_diamond_balance table
 */
export async function queryDiamondBalance(userId) {
    try {
        const data = await fetchWithAuth(
            `/rest/v1/user_diamond_balance?user_id=eq.${userId}&select=balance`
        );
        return data[0]?.balance || 0;
    } catch (e) {
        console.warn('[AuthUtils] Diamond balance fetch error:', e);
        return 0;
    }
}

/**
 * Query social posts with pagination
 */
export async function querySocialPosts(offset = 0, limit = 10) {
    const params = new URLSearchParams({
        select: 'id,content,content_type,media_urls,like_count,comment_count,share_count,created_at,author_id,link_url,link_title,link_description,link_image,link_site_name,metadata',
        or: '(visibility.eq.public,visibility.is.null)',
        order: 'created_at.desc',
        offset: offset.toString(),
        limit: limit.toString()
    });

    return fetchWithAuth(`/rest/v1/social_posts?${params}`);
}

/**
 * Query any table with flexible parameters
 */
export async function queryTable(table, params = {}) {
    const queryParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params || {})) {
        queryParams.append(key, value.toString());
    }

    return fetchWithAuth(`/rest/v1/${table}?${queryParams}`);
}

/**
 * Insert data into a table
 */
export async function insertIntoTable(table, data) {
    return fetchWithAuth(`/rest/v1/${table}`, {
        method: 'POST',
        body: JSON.stringify(data),
        prefer: 'return=representation'
    });
}

/**
 * Update data in a table
 */
export async function updateTable(table, match, data) {
    const matchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(match || {})) {
        matchParams.append(key, `eq.${value}`);
    }

    return fetchWithAuth(`/rest/v1/${table}?${matchParams}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        prefer: 'return=representation'
    });
}

/**
 * React hook for getting current user with auto-refresh
 * Listens for cross-tab storage changes for session sync
 */
export function useAuthUser() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const authUser = getAuthUser();
        setUser(authUser);
        setLoading(false);

        // Listen for storage changes (cross-tab auth sync)
        const handleStorage = (e) => {
            // Listen for both explicit key and legacy keys
            if (e.key === 'smarter-poker-auth' ||
                (e.key?.startsWith('sb-') && e.key?.endsWith('-auth-token'))) {
                setUser(getAuthUser());
            }
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    return { user, loading };
}

// Need to import these for the hooks
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ SESSION BACKUP / RESTORE — Last line of defense against accidental logout
// ═══════════════════════════════════════════════════════════════════════════
const AUTH_STORAGE_KEY = 'smarter-poker-auth';
const AUTH_BACKUP_KEY = 'smarter-poker-auth-backup';
const BACKUP_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Backup the current session to a separate localStorage key.
 */
export function backupSession() {
    if (typeof window === 'undefined') return;
    try {
        const current = localStorage.getItem(AUTH_STORAGE_KEY);
        if (current) {
            localStorage.setItem(AUTH_BACKUP_KEY, JSON.stringify({
                session: current,
                timestamp: Date.now(),
            }));
        }
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
}

/**
 * Attempt to restore the session from backup.
 * Returns true if restoration succeeded, false otherwise.
 */
export function restoreSessionBackup() {
    if (typeof window === 'undefined') return false;
    try {
        const backup = localStorage.getItem(AUTH_BACKUP_KEY);
        if (!backup) return false;

        const { session, timestamp } = JSON.parse(backup);
        if (Date.now() - timestamp > BACKUP_TTL_MS) {
            localStorage.removeItem(AUTH_BACKUP_KEY);
            return false;
        }

        if (session && !localStorage.getItem(AUTH_STORAGE_KEY)) {
            localStorage.setItem(AUTH_STORAGE_KEY, session);
            console.debug('[authUtils] 🛡️ Session restored from backup');
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

/**
 * Check if a session backup exists and is still valid.
 */
export function hasSessionBackup() {
    if (typeof window === 'undefined') return false;
    try {
        const backup = localStorage.getItem(AUTH_BACKUP_KEY);
        if (!backup) return false;
        const { timestamp } = JSON.parse(backup);
        return (Date.now() - timestamp) < BACKUP_TTL_MS;
    } catch (e) { return false; }
}

/**
 * Clear all auth data from localStorage.
 * HARDENED: Creates a backup before clearing so we can recover from accidental logouts.
 * Use force=true for sovereign (user-initiated) logout to skip backup.
 */
export function clearAuth(force = false) {
    if (typeof window === 'undefined') return;

    try {
        if (!force) {
            backupSession();
        } else {
            localStorage.removeItem(AUTH_BACKUP_KEY);
        }

        localStorage.removeItem(AUTH_STORAGE_KEY);
        // Clear fast-path flag so useRequireAuth does full check after logout
        try { sessionStorage.removeItem('sp_auth_confirmed'); } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }
        const sbKeys = Object.keys(localStorage || {}).filter(
            k => k.startsWith('sb-') && k.endsWith('-auth-token')
        );
        sbKeys.forEach(k => localStorage.removeItem(k));
    } catch (e) {
        console.warn('[authUtils] Error clearing auth:', e);
    }
}

export default {
    getAuthUser,
    getSafeUser,
    ensureAuthReady,
    useRequireAuth,
    getSessionToken,
    getAccessToken,
    authedFetch,
    createAuthedFetcher,
    fetchWithAuth,
    queryProfiles,
    queryDiamondBalance,
    querySocialPosts,
    queryTable,
    insertIntoTable,
    updateTable,
    useAuthUser,
    backupSession,
    restoreSessionBackup,
    hasSessionBackup,
    clearAuth,
    SUPABASE_URL,
    SUPABASE_ANON_KEY
};
