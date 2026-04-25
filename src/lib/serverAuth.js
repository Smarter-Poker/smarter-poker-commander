/**
 * SERVER-SIDE AUTH UTILITY
 *
 * Extracts user identity from the JWT Authorization header.
 *
 * SECURITY NOTE (phase40, 2026-04-20):
 * Previous version used `jwt.decode()` which only BASE64-decodes the payload
 * without verifying the HMAC signature. That allowed any attacker to forge
 * a JWT with an arbitrary `sub` claim and impersonate any user on routes
 * that used `getServerUser`. This version verifies the HMAC-SHA256 signature
 * against SUPABASE_JWT_SECRET before trusting any claim.
 *
 * If SUPABASE_JWT_SECRET is not configured, verification FAILS CLOSED — the
 * function returns null and every caller gets a 401. That's strictly better
 * than silently accepting forged tokens.
 *
 * USAGE (unchanged from previous version):
 *   import { getServerUser } from '../lib/serverAuth';
 *
 *   const user = getServerUser(req);
 *   if (!user) return res.status(401).json({ error: 'Auth required' });
 *   // user.id is the UUID
 *
 * Also exported:
 *   getServerUserWithFallback(req, supabase) — async variant that falls back
 *   to supabase.auth.getUser(token) if local verification is unavailable
 *   (e.g., SUPABASE_JWT_SECRET missing). Useful for routes that need to keep
 *   working during a rotation window. Must never be used to bypass verification.
 */

const crypto = require('crypto');

function base64UrlDecode(str) {
    // Convert base64url → base64, then decode.
    let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    // Pad to multiple of 4.
    while (b64.length % 4) b64 += '=';
    return Buffer.from(b64, 'base64');
}

/**
 * Verify a Supabase JWT (HS256) locally. Returns the decoded payload object
 * or null if the token is malformed, wrong algorithm, signature invalid, or
 * expired. No network calls.
 */
function verifySupabaseJwt(token, secret) {
    if (typeof token !== 'string' || typeof secret !== 'string' || !secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Parse header — must be HS256 (what Supabase signs with).
    let header;
    try {
        header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    } catch (_e) {
        return null;
    }
    if (!header || header.alg !== 'HS256' || (header.typ && header.typ !== 'JWT')) {
        return null;
    }

    // Recompute the signature over the signing input.
    const signingInput = `${headerB64}.${payloadB64}`;
    const expected = crypto.createHmac('sha256', secret).update(signingInput).digest();
    const got = base64UrlDecode(signatureB64);

    // Length check first, then timing-safe compare.
    if (expected.length !== got.length) return null;
    let equal = false;
    try {
        equal = crypto.timingSafeEqual(expected, got);
    } catch (_e) {
        return null;
    }
    if (!equal) return null;

    // Parse payload.
    let payload;
    try {
        payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
    } catch (_e) {
        return null;
    }

    // Reject expired tokens (exp is required on Supabase JWTs).
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;

    // Reject tokens not yet valid.
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec) return null;

    return payload;
}

/**
 * Extract a verified user from the Authorization header JWT.
 * Returns { id, email, role, aud } or null if no valid token.
 *
 * Fails closed if SUPABASE_JWT_SECRET is not configured.
 */
function getServerUser(req) {
    try {
        const authHeader = req?.headers?.authorization;
        if (!authHeader || typeof authHeader !== 'string') return null;
        if (!authHeader.startsWith('Bearer ')) return null;

        const token = authHeader.slice(7).trim();
        if (!token || token.length < 20) return null;

        const secret = process.env.SUPABASE_JWT_SECRET;
        if (!secret) {
            // Fail closed: refuse to accept any token if we cannot verify it.
            // Log once per cold start so the misconfig is observable.
            if (!getServerUser._warnedMissingSecret) {
                getServerUser._warnedMissingSecret = true;
                // eslint-disable-next-line no-console
                console.warn('[serverAuth] SUPABASE_JWT_SECRET not set — all JWT verification will fail. Set this env var in Vercel to restore auth.');
            }
            return null;
        }

        const payload = verifySupabaseJwt(token, secret);
        if (!payload) return null;

        const userId = payload.sub;
        if (!userId || typeof userId !== 'string') return null;

        return {
            id: userId,
            email: payload.email || null,
            role: payload.role || 'authenticated',
            aud: payload.aud || null,
        };
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
}

/**
 * Full auth extraction with supabase.auth.getUser fallback.
 * Tries local HMAC verification first, then network call to GoTrue.
 *
 * The fallback is safe (GoTrue verifies the signature), but slower. Use only
 * when you need operational resilience during a JWT_SECRET rotation window.
 */
async function getServerUserWithFallback(req, supabase) {
    // 1. Fast path: local HMAC verification.
    const localUser = getServerUser(req);
    if (localUser) return { user: localUser, error: null };

    // 2. Fallback: network call to GoTrue (verifies signature server-side).
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return { user: null, error: 'No token' };

        const { data: authData, error } = await supabase.auth.getUser(token);

        const user = authData?.user;
        if (user) return { user, error: null };
        return { user: null, error: error?.message || 'Invalid token' };
    } catch (e) {
        return { user: null, error: e.message };
    }
}

module.exports = { getServerUser, getServerUserWithFallback, verifySupabaseJwt };
