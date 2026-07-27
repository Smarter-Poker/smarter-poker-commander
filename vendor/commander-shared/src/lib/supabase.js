/**
 * Supabase client shim for Node ESM test runner.
 *
 * The real client is in supabase.ts (resolved by Next.js/Webpack).
 * When running tests via raw `node tests/foo.test.mjs`, Node ESM
 * resolves `../supabase` to this .js file instead of the .ts file.
 *
 * This provides a no-op mock so test files that transitively import
 * decision-bridge.js (which imports ../supabase) can load and run
 * without a real Supabase connection.
 *
 * NOT used in production — Next.js always resolves to supabase.ts.
 */

const mockClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
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

export const supabase = mockClient;
export default mockClient;
