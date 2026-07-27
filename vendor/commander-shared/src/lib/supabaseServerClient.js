/**
 * SUPABASE SERVER CLIENT PATCH — Phase 4.1d ESM port (2026-04-25)
 *
 * Patches the Supabase client's auth.getUser method to use local JWT
 * decoding when the GoTrue network call fails.
 *
 * WHY:
 * supabase.auth.getUser(token) makes a network call to GoTrue which
 * intermittently fails on Vercel (timeout/AbortError), causing ALL API
 * routes to return 401 "Invalid token". This patch catches those failures
 * and falls back to local HMAC verification.
 *
 * Phase 4.1d port:
 *   - require/module.exports → ESM import/export
 *   - decodeSupabaseJWT() now async (depends on async verifySupabaseJwt)
 *   - patched getUser still resolves the full call asynchronously, so
 *     no caller signature change.
 */

import { createClient as originalCreateClient } from '@supabase/supabase-js';
import { verifySupabaseJwt } from './serverAuth.js';

/**
 * Decode a Supabase JWT locally without network call.
 * Returns a user-like object or null. Async.
 */
async function decodeSupabaseJWT(token) {
  try {
    if (!token || token.length < 10) return null;

    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      console.warn('[supabase-patch] SUPABASE_JWT_SECRET not configured, refusing to locally verify token.');
      return null;
    }

    const decoded = await verifySupabaseJwt(token, secret);
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
    console.warn('[supabase-patch] decodeSupabaseJWT error:', e?.message || e);
    return null;
  }
}

/**
 * Patched createClient that wraps auth.getUser with local JWT fallback.
 *
 * Sync — returns a SupabaseClient synchronously. The internal
 * patched auth.getUser is async (always was — no behavior change for callers).
 */
export function createClient(url, key, options) {
  const resolvedUrl = url || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
  const resolvedKey = key || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!resolvedKey) {
    console.warn('[FATAL] No Supabase key available — check SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const client = originalCreateClient(resolvedUrl, resolvedKey || 'missing-key', options);

  // Reference original getUser
  const originalGetUser = client.auth.getUser.bind(client.auth);

  // Replace with resilient version
  client.auth.getUser = async function patchedGetUser(token) {
    // First try the original GoTrue call
    try {
      const result = await originalGetUser(token);
      if (result.data?.user) {
        return result;
      }
    } catch (e) {
      console.warn('[supabase-patch] GoTrue getUser failed, trying local:', e?.message || e);
    }

    // Fallback: decode JWT locally
    if (token) {
      const localUser = await decodeSupabaseJWT(token);
      if (localUser) {
        return {
          data: { user: localUser },
          error: null,
        };
      }
    }

    return {
      data: { user: null },
      error: { message: 'Token verification failed (both GoTrue and local decode)' },
    };
  };

  return client;
}

export { decodeSupabaseJWT };

// CommonJS-compatibility wrapper — some legacy callers use require()
// pattern via Next.js bundler (635 files import this module). All of
// them use ESM `import {createClient}` syntax which works fine with
// the export above. Keep no `module.exports` line — it would conflict
// with ESM mode in Next.js 14.
