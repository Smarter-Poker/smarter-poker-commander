/**
 * Club Commander - Supabase browser client.
 *
 * Intentionally does NOT re-export from commander-shared because that
 * package resolves its ./lib/supabase entry to a test mock shim that
 * has no real auth methods, causing "signInWithPassword is not a function"
 * in production.  This file owns the real client directly.
 *
 * [2026-08-19] Applied resolveAnonKey() guard (same as main hub) to prevent
 * "Legacy API keys are disabled" - the Vercel env var still holds the old JWT,
 * so we fall back to the publishable key automatically.
 *
 * [2026-09-01] Single-instance guard. This module and
 * vendor/commander-shared/src/lib/supabase.js both created a real browser
 * client with storageKey 'smarter-poker-auth'. Two GoTrue instances
 * autorefreshing one storage key means each writes tokens the other then
 * re-reads - a refresh storm plus a rotation race. Both modules now share the
 * SAME instance via globalThis.__commanderSharedSupabase, so whichever
 * evaluates first wins and the other returns the identical object.
 */
import { createClient } from '@supabase/supabase-js';
import { resolveAnonKey, anonKeyWarning } from './supabaseKeys.js';
import { setAccessTokenProvider } from './commander/staffSession';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
const _anonResolved = resolveAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const supabaseAnonKey = _anonResolved.key;
const _anonWarning = anonKeyWarning(_anonResolved.source);
if (_anonWarning) console.warn(_anonWarning);

if (!supabaseAnonKey) {
  console.error('[Commander] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set - auth will fail.');
}

// 2026-07-25 audit fix: use the platform-wide storage key. The old
// 'commander-auth' key was invisible to clientAuth.getToken() and
// premiumFeatureGate (both read 'smarter-poker-auth' / sb-*), so users who
// logged in on the commander origin sent no Authorization header and were
// bounced by Bearer-authenticated APIs.
//
// The storage key is ALSO the reason the globalThis cache below exists: two
// clients on one storage key is the failure mode, not two clients per se.
const _g = typeof globalThis !== 'undefined' ? globalThis : null;

const supabase = (_g && _g.__commanderSharedSupabase) || createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'smarter-poker-auth',
  },
});

// Publish for vendor/commander-shared/src/lib/supabase.js, which reads the
// same slot. Keep this key and the client options in sync with that file.
if (_g && !_g.__commanderSharedSupabase) _g.__commanderSharedSupabase = supabase;

// 2026-09-04: give the staff-session self-heal a token that is refreshed on
// demand. Without this it re-minted with whatever expired access_token was
// last cached in localStorage and got 401 "Invalid token" after an hour idle.
if (typeof window !== 'undefined') {
  setAccessTokenProvider(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  });
}

export { supabase };
export default supabase;
