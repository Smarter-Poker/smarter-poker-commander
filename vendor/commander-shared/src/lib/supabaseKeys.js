/**
 * Re-export of the app's Supabase API-key guard, for use inside this vendored
 * package.
 *
 * WHY THIS SHIM EXISTS
 * --------------------
 * The legacy JWT API keys (`anon`, `service_role`) were disabled on project
 * kuklfnapbkmacvwxktbh on 2026-08-16. Every request carrying one now returns
 * `{"message":"Legacy API keys are disabled"}`. `resolveAnonKey()` in
 * src/lib/supabaseKeys.js is the single guard that swaps a legacy key for the
 * publishable key, and it already protects src/lib/supabase.js and
 * middleware.ts.
 *
 * Modules inside vendor/commander-shared were bypassing it — most seriously
 * authUtils.js, which carried a hardcoded legacy anon-key literal as an env
 * fallback. Rather than duplicate the guard (or the key) per vendored file,
 * every vendored module imports it from here, so there is exactly one place
 * where this package reaches across into the app's src/.
 *
 * This is a repo-local addition; it has no upstream counterpart in World-Hub's
 * shared package, where these modules sit next to src/lib/supabaseKeys.js
 * directly. src/lib/serverAuth.js is the same kind of shim pointing the other
 * way.
 */
export {
  resolveAnonKey,
  anonKeyWarning,
  isLegacyJwtKey,
  isModernKey,
  SUPABASE_PUBLISHABLE_FALLBACK,
  SUPABASE_URL_FALLBACK,
} from '../../../../src/lib/supabaseKeys.js';
