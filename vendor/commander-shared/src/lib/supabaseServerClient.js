/**
 * SUPABASE SERVER CLIENT PATCH - Phase 4.1d ESM port (2026-04-25)
 *
 * Patches the Supabase client's auth.getUser method to verify JWTs LOCALLY
 * first, falling back to the GoTrue network call only when local verification
 * fails or cannot run.
 *
 * WHY:
 * supabase.auth.getUser(token) makes a network call to GoTrue which
 * intermittently fails on Vercel (timeout/AbortError), causing ALL API
 * routes to return 401 "Invalid token". That is the resilience the patch was
 * originally written for. Since 2026-09-01 the ordering is also a volume
 * control: every authenticated route calls getUser on every request, so doing
 * the network call first meant a full HTTPS round trip to GoTrue per request,
 * which saturated the project-wide GoTrue rate limit.
 *
 * ORDERING NOTE: local-first, network-second. The docblock here used to say
 * the patch falls back to local decoding "when the GoTrue network call fails",
 * which described the pre-2026-09-01 ordering and is now backwards. The
 * authoritative explanation of the ordering, and why it must not be flipped
 * back, is the comment block inside patchedGetUser below.
 *
 * Phase 4.1d port:
 *   - require/module.exports -> ESM import/export
 *   - decodeSupabaseJWT() now async (depends on async verifySupabaseJwt)
 *   - patched getUser still resolves the full call asynchronously, so
 *     no caller signature change.
 *
 * Phase 4.2 (2026-09-01):
 *   - Removed the SUPABASE_JWT_SECRET guard from decodeSupabaseJWT. The
 *     project migrated to asymmetric signing keys; that env var is absent
 *     from .env.example and the symmetric secret no longer exists. The
 *     guard therefore fired on every request and returned null BEFORE
 *     reaching the verifier, which silently defeated the ES256 migration
 *     in serverAuth.js for every file that imports this module.
 *   - verifySupabaseJwt() now resolves keys from the project JWKS and
 *     ignores its legacy `secret` argument, so nothing here needs it.
 *   - patchedGetUser flipped to local-first, network-second.
 */

import { createClient as originalCreateClient } from '@supabase/supabase-js';
import { verifySupabaseJwt } from './serverAuth.js';

/**
 * Decode a Supabase JWT locally without network call.
 * Returns a user-like object or null. Async.
 *
 * Verification (signature over the project JWKS, plus exp/nbf/iss/aud)
 * lives entirely in serverAuth.js verifySupabaseJwt. Do NOT add an env-var
 * precondition in front of it again - JWKS is fetched from
 * NEXT_PUBLIC_SUPABASE_URL and cached, there is no secret to configure.
 * An env guard here is indistinguishable from a total auth outage in the
 * logs, because both look like "GoTrue is serving every request".
 */
async function decodeSupabaseJWT(token) {
  try {
    if (!token || token.length < 10) return null;

    const decoded = await verifySupabaseJwt(token);
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
 * Sync - returns a SupabaseClient synchronously. The internal
 * patched auth.getUser is async (always was - no behavior change for callers).
 */
export function createClient(url, key, options) {
  const resolvedUrl = url || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
  const resolvedKey = key || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!resolvedKey) {
    console.warn('[FATAL] No Supabase key available - check SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const client = originalCreateClient(resolvedUrl, resolvedKey || 'missing-key', options);

  // Reference original getUser
  const originalGetUser = client.auth.getUser.bind(client.auth);

  // Replace with resilient version
  client.auth.getUser = async function patchedGetUser(token) {
    // ORDERING IS LOAD-BEARING - LOCAL FIRST, NETWORK SECOND.
    // DO NOT FLIP THIS BACK (2026-09-01, performance).
    //
    // Commander was network-first until 2026-09-01: this patch called
    // GoTrue over the network FIRST and only decoded locally when that call
    // threw or returned no user. World Hub reversed exactly this ordering
    // on 2026-08-24 for performance and has run local-first in production
    // since; commander is now brought in line with it.
    //
    // Every authenticated route calls getUser on every single request, so
    // network-first meant every request paid a full HTTPS round-trip to
    // GoTrue - which in turn loads the same Postgres instance that is
    // already saturated. Local verification is the identical security check
    // (ES256 signature over the project JWKS, plus exp/nbf/iss/aud - see
    // serverAuth.js verifySupabaseJwt) done in microseconds with zero
    // network and zero database load, against a JWKS fetched once and
    // cached.
    //
    // 2026-09-01 POST-MORTEM: the local fast path was DEAD for months, for
    // two independent reasons stacked on each other. (1) decodeSupabaseJWT
    // required SUPABASE_JWT_SECRET before it would call the verifier, and
    // that var was never set in any environment. (2) The verifier itself
    // still demanded alg=HS256 after the project moved to ES256 signing
    // keys. Either alone was sufficient to kill it. Both are fixed earlier
    // in this PR - but under the old network-first ordering that fix
    // restored correctness ONLY: the GoTrue call still ran first and still
    // succeeded, so request volume from this path did not fall. That volume
    // saturated the project-wide GoTrue rate limit and cascaded into a
    // site-wide auth redirect loop (every open tab bounced to
    // /auth/login). Flipping the ordering is what actually removes it.
    //
    // The failure mode is silent - nothing errors, the site just gets
    // slower and then falls over - so keep this ordering, and keep both
    // fixes above, intact.
    //
    // Error semantics are unchanged: a malformed, tampered or expired token
    // fails local verification, then still falls through to GoTrue, and if
    // GoTrue also rejects it the caller gets the same
    // { data: { user: null }, error: { message } } shape it got before.
    // The network path is also still taken whenever local verification is
    // IMPOSSIBLE - JWKS unreachable on a cold start, or a signing-key
    // rotation window before the cached key set refreshes - so this keeps
    // the operational resilience the patch was written for.
    //
    // Accepted trade-off: a token that is cryptographically valid but whose
    // user was deleted or banned inside GoTrue mid-token-lifetime is now
    // accepted until that token expires. Supabase access tokens are
    // short-lived; the alternative is a network call on every request of
    // every route.

    // 1. Fast path: local ES256 verify + decode. No network, no DB.
    if (token) {
      const localUser = await decodeSupabaseJWT(token);
      if (localUser) {
        return {
          data: { user: localUser },
          error: null,
        };
      }
    }

    // 2. Fallback: the original GoTrue network call. Reached only when local
    //    verification failed or could not run at all.
    try {
      const result = await originalGetUser(token);
      if (result.data?.user) {
        return result;
      }
      // GoTrue answered but rejected the token - preserve its error verbatim.
      if (result?.error) {
        return result;
      }
    } catch (e) {
      console.warn('[supabase-patch] GoTrue getUser failed after local decode failed:', e?.message || e);
    }

    return {
      data: { user: null },
      error: { message: 'Token verification failed (both GoTrue and local decode)' },
    };
  };

  return client;
}

export { decodeSupabaseJWT };

// CommonJS-compatibility wrapper - some legacy callers use require()
// pattern via Next.js bundler (635 files import this module). All of
// them use ESM `import {createClient}` syntax which works fine with
// the export above. Keep no `module.exports` line - it would conflict
// with ESM mode in Next.js 14.
