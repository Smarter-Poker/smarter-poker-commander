/**
 * Club Commander — Supabase browser client.
 *
 * Intentionally does NOT re-export from commander-shared because that
 * package resolves its ./lib/supabase entry to a test mock shim that
 * has no real auth methods, causing "signInWithPassword is not a function"
 * in production.  This file owns the real client directly.
 *
 * [2026-08-19] Applied resolveAnonKey() guard (same as main hub) to prevent
 * "Legacy API keys are disabled" — the Vercel env var still holds the old JWT,
 * so we fall back to the publishable key automatically.
 */
import { createClient } from '@supabase/supabase-js';
import { resolveAnonKey, anonKeyWarning } from './supabaseKeys.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
const _anonResolved = resolveAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const supabaseAnonKey = _anonResolved.key;
const _anonWarning = anonKeyWarning(_anonResolved.source);
if (_anonWarning) console.warn(_anonWarning);

if (!supabaseAnonKey) {
  console.error('[Commander] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set — auth will fail.');
}

// 2026-07-25 audit fix: use the platform-wide storage key. The old
// 'commander-auth' key was invisible to clientAuth.getToken() and
// premiumFeatureGate (both read 'smarter-poker-auth' / sb-*), so users who
// logged in on the commander origin sent no Authorization header and were
// bounced by Bearer-authenticated APIs.
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'smarter-poker-auth',
  },
});

export { supabase };
export default supabase;
