/**
 * Supabase client for the shared package.
 *
 * 2026-08-04 audit fix: this file used to export ONLY a no-op mock client,
 * with a header claiming "Next.js always resolves to supabase.ts". That is
 * true in World Hub, which ships a supabase.ts next to this file - but the
 * vendored copy in smarter-poker-commander has no supabase.ts, so every
 * relative `import { supabase } from '../supabase'` inside this package
 * (useCommanderSync, useTournamentRealtime, FloorCallAlert, CommanderLayout)
 * resolved to the mock in the production bundle:
 *   - Supabase Realtime never connected (the mock channel().subscribe() is
 *     inert), so cross-device sync silently degraded to same-browser
 *     BroadcastChannel only;
 *   - FloorCallAlert's 20s safety poll threw on the mock query builder (no
 *     chained .eq().eq()) and the error was swallowed - floor calls raised
 *     from another device never alerted;
 *   - CommanderLayout's logout called supabase.auth.signOut(), which the mock
 *     does not define, so the Supabase session survived "Sign Out".
 *
 * The export is now a REAL browser client, created only when an anon key is
 * configured. Without env configuration (bare `node tests/foo.test.mjs` runs)
 * it still falls back to the original no-op mock, preserving the test-shim
 * behavior this file was created for.
 *
 * 2026-09-01, TWO FIXES:
 *
 * 1. SINGLE INSTANCE. This module and src/lib/supabase.js each called
 *    createClient() with storageKey 'smarter-poker-auth'. The
 *    globalThis.__commanderSharedSupabase cache here only deduped repeat
 *    evaluations of THIS module - it did not dedupe against src/lib/supabase.js,
 *    which never touched the cache. Any page whose import graph reached both
 *    ended up with two GoTrue instances autorefreshing the same storage key,
 *    each writing tokens the other re-reads: a refresh storm and a
 *    token-rotation race. src/lib/supabase.js now publishes into the same slot
 *    and reads it first, so both import paths return the identical object no
 *    matter which one evaluates first. Keep the client options below identical
 *    to that file.
 *
 * 2. KEY GUARD. This file read raw NEXT_PUBLIC_SUPABASE_ANON_KEY with no
 *    resolveAnonKey() guard, so it shipped whatever the env var holds - which
 *    on Vercel is still the legacy JWT API key that was disabled on
 *    2026-08-16 ("Legacy API keys are disabled"). It now goes through the same
 *    guard as src/lib/supabase.js, middleware.ts and authUtils.js.
 *
 *    The mock fallback is deliberately still gated on the RAW env var being
 *    absent, NOT on the resolved key: resolveAnonKey() always returns a usable
 *    key (it falls back to the publishable one), so gating on the resolved
 *    value would have quietly turned every no-env test run into a real client.
 */
import { createClient } from '@supabase/supabase-js';
import { resolveAnonKey, anonKeyWarning } from './supabaseKeys.js';

const mockClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: () => ({
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        limit: () => Promise.resolve({ data: [], error: null }),
      }),
      order: () => ({
        limit: () => Promise.resolve({ data: [], error: null }),
      }),
      limit: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    }),
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }),
    delete: () => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }),
    upsert: () => Promise.resolve({ data: null, error: null }),
  }),
  rpc: () => Promise.resolve({ data: null, error: null }),
  channel: () => {
    const ch = {
      on: () => ch,           // chainable - returns self like real supabase
      subscribe: () => ch,
      unsubscribe: () => {},
    };
    return ch;
  },
  removeChannel: () => {},
};

function buildClient() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';

    // Gate on the RAW env var, not the resolved key - see fix 2 in the header.
    const rawAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!rawAnonKey) return mockClient;

    const g = typeof globalThis !== 'undefined' ? globalThis : null;
    // Shared with src/lib/supabase.js - whichever module evaluates first wins.
    if (g && g.__commanderSharedSupabase) return g.__commanderSharedSupabase;

    const resolved = resolveAnonKey(rawAnonKey);
    const warning = anonKeyWarning(resolved.source);
    if (warning) console.warn(warning);

    const client = createClient(url, resolved.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Same key as src/lib/supabase.js - one shared persisted session,
        // and now one shared CLIENT via the globalThis slot above.
        storageKey: 'smarter-poker-auth',
      },
    });
    if (g) g.__commanderSharedSupabase = client;
    return client;
  } catch (e) {
    console.warn('[commander-shared/supabase] falling back to mock client:', e?.message || e);
    return mockClient;
  }
}

export const supabase = buildClient();
export default supabase;
