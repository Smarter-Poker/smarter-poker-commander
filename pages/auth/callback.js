/**
 * OAuth callback for the commander origin (2026-07-25 audit fix).
 *
 * Google/OAuth sign-in from /commander/login redirects to
 * `${window.location.origin}/auth/callback`. On commander.smarter.poker this
 * page did not exist, so OAuth dead-ended on a 404 after consent. This page
 * completes the session (supabase-js parses the URL hash / PKCE code on init)
 * and forwards the user back into the Commander login flow, which finishes
 * the subscription check + staff-session issuance.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../src/lib/supabase';

export default function AuthCallback() {
  const router = useRouter();
  const [message, setMessage] = useState('Completing sign-in...');

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      try {
        // supabase-js (detectSessionInUrl) consumes the OAuth params on
        // creation; poll briefly for the session to land.
        for (let i = 0; i < 20; i++) {
          const { data } = await supabase.auth.getSession();
          if (data?.session) {
            if (!cancelled) {
              // login.js checks this flag for OAuth logins that started on
              // the commander login page.
              window.location.replace('/commander/login?oauth=1');
            }
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!cancelled) {
          setMessage('Sign-in could not be completed. Redirecting to login...');
          setTimeout(() => window.location.replace('/commander/login'), 1500);
        }
      } catch (err) {
        console.warn('OAuth callback error:', err);
        if (!cancelled) window.location.replace('/commander/login');
      }
    }

    finish();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#18191A', color: '#E4E6EB', fontFamily: 'Inter, sans-serif' }}>
      <p>{message}</p>
    </div>
  );
}
