/**
 * SUPABASE SERVER CLIENT PATCH
 * 
 * This module patches the Supabase client's auth.getUser method to use
 * local JWT decoding when the GoTrue network call fails.
 * 
 * HOW IT WORKS:
 * We patch the global `createClient` from @supabase/supabase-js so that
 * every server-side Supabase client automatically has a resilient getUser.
 * 
 * WHAT IT FIXES:
 * supabase.auth.getUser(token) makes a network call to GoTrue which
 * intermittently fails on Vercel (timeout/AbortError), causing ALL API
 * routes to return 401 "Invalid token". This patch catches those failures
 * and falls back to local JWT decoding.
 */

const { verifySupabaseJwt } = require('./serverAuth');
const originalCreateClient = require('@supabase/supabase-js').createClient;

/**
 * Decode a Supabase JWT locally without network call.
 * Returns a user-like object or null.
 */
function decodeSupabaseJWT(token) {
    try {
        if (!token || token.length < 10) return null;

        const secret = process.env.SUPABASE_JWT_SECRET;
        if (!secret) {
            console.warn('[supabase-patch] SUPABASE_JWT_SECRET not configured, refusing to locally verify token.');
            return null;
        }

        const decoded = verifySupabaseJwt(token, secret);
        if (!decoded) return null;

        if (!decoded.sub) return null;

        return {
            id: decoded.sub,
            email: decoded.email || null,
            role: decoded.role || 'authenticated',
            aud: decoded.aud || null,
            app_metadata: decoded.app_metadata || {},
            user_metadata: decoded.user_metadata || {},
        };
    } catch (e) {
        return null;
    }
}

/**
 * Patched createClient that wraps auth.getUser with local JWT fallback.
 */
function createClientPatched(url, key, options) {
    // Hardened: resolve env var with fallback if caller passes undefined
    const resolvedUrl = url || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const resolvedKey = key || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!resolvedKey) {
        console.warn('[FATAL] No Supabase key available — check SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }

    const client = originalCreateClient(resolvedUrl, resolvedKey || 'missing-key', options);

    // Store reference to original getUser
    const originalGetUser = client.auth.getUser.bind(client.auth);

    // Replace with resilient version
    client.auth.getUser = async function patchedGetUser(token) {
        // First try the original GoTrue call
        try {
            const result = await originalGetUser(token);
            if (result.data?.user) {
                return result; // GoTrue worked, return as-is
            }
        } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

        // Fallback: decode JWT locally
        if (token) {
            const localUser = decodeSupabaseJWT(token);
            if (localUser) {
                return {
                    data: { user: localUser },
                    error: null,
                };
            }
        }

        // Both methods failed
        return {
            data: { user: null },
            error: { message: 'Token verification failed (both GoTrue and local decode)' },
        };
    };

    return client;
}

module.exports = { createClient: createClientPatched, decodeSupabaseJWT };
