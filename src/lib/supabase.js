/**
 * Club Commander — Supabase browser client.
 *
 * Intentionally does NOT re-export from commander-shared because that
 * package resolves its ./lib/supabase entry to a test mock shim that
 * has no real auth methods, causing "signInWithPassword is not a function"
 * in production.  This file owns the real client directly.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseAnonKey) {
  console.error('[Commander] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set — auth will fail.');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'commander-auth',
  },
});

export { supabase };
export default supabase;
