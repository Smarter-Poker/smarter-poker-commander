/**
 * Supabase client for the shared package.
 *
 * 2026-08-04 audit fix: this file used to export ONLY a no-op mock client,
 * with a header claiming "Next.js always resolves to supabase.ts". That is
 * true in World Hub, which ships a supabase.ts next to this file — but the
 * vendored copy in smarter-poker-commander has no supabase.ts, so every
 * relative `import { supabase } from '../supabase'` inside this package
 * (useCommanderSync, useTournamentRealtime, FloorCallAlert, CommanderLayout)
 * resolved to the mock in the production bundle:
 *   - Supabase Realtime never connected (the mock channel().subscribe() is
 *     inert), so cross-device sync silently degraded to same-browser
 *     BroadcastChannel only;
 *   - FloorCallAlert's 20s safety poll threw on the mock query builder (no
 *     chained .eq().eq()) and the error was swallowed — floor calls raised
 *     from another device never alerted;
 *   - CommanderLayout's logout called supabase.auth.signOut(), which the mock
 *     does not define, so the Supabase session survived "Sign Out".
 *
 * The export is now a REAL browser client (mirroring src/lib/supabase.js,
 * same storageKey so both clients share one persisted session), created only
 * when an anon key is available and cached on globalThis so repeat module
 * evaluations do not spawn duplicate GoTrue instances. Without env
 * configuration (raw `node tests/foo.test.mjs` runs) it still falls back to
 * the original no-op mock, preserving the test-shim behavior this file was
 * created for.
 */
import { createClient } from '@supabase/supabase-js';

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
      on: () => ch,           // chainable — returns self like real supabase
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
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!anonKey) return mockClient;

    const g = typeof globalThis !== 'undefined' ? globalThis : null;
    if (g && g.__commanderSharedSupabase) return g.__commanderSharedSupabase;

    const client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Same key as src/lib/supabase.js — one shared persisted session.
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
