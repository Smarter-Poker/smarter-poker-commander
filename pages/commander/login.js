/**
 * Commander Owner/Manager Login Page
 * Email + Password for venue owners
 * SmarterPoker color scheme
 *
 * [2026-08-19] Added SSO bridge: if user is already signed in on smarter.poker
 * (detected via shared 'smarter-poker-auth' localStorage key), a
 * "Continue as [email]" button appears so they never need to re-enter credentials.
 *
 * [2026-09-03] ROOT-CAUSE FIX. Every sign-in path on this page (password,
 * Google, silent restore, ?expired=1 recovery, SSO) ended in a call to
 * `completeLogin()`, which no longer existed in this file. Supabase accepted
 * the credentials and then the page threw `completeLogin is not defined` -
 * shown to the user as the login error. Login completion now lives in the
 * shared staffSession module (same code the /auth/sso page uses).
 *
 * Also fixed here:
 *   - "Continue As Smarter.Poker" was a dead button whenever this page was
 *     opened directly on commander.smarter.poker (no hub session in THIS
 *     origin's localStorage => onClick was undefined). It now bridges through
 *     the smarter.poker origin (?bridge=1), which holds the hub session and
 *     hands back a one-time SSO token - no second login.
 *   - When a Supabase session already exists on this origin, "Continue"
 *     completes the login directly instead of a needless SSO round-trip.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { supabase } from '../../src/lib/supabase';
import {
  completeCommanderLogin,
  isStaffSessionHealthy,
  readStaffSession,
} from '../../src/lib/commander/staffSession';
import { reportLoginFailure } from '../../src/lib/authFlowMonitor';

const HUB_ORIGIN = process.env.NEXT_PUBLIC_MAIN_HUB_URL || 'https://smarter.poker';

function isHubOrigin() {
  if (typeof window === 'undefined') return false;
  try { return window.location.origin === new URL(HUB_ORIGIN).origin; } catch { return false; }
}

export default function CommanderLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showReset, setShowReset] = useState(false);

  // SSO bridge state - set when a smarter.poker session is readable from
  // THIS origin's localStorage (same-origin /commander/* rewrite path).
  const [ssoEmail, setSsoEmail] = useState(null);
  const [ssoLoading, setSsoLoading] = useState(false);

  /**
   * Finish a Commander login for an authenticated Supabase user. Resolves
   * `true` when we are navigating away, `false` when the form should stay
   * (the specific reason is already in `error`).
   */
  const completeLogin = useCallback(async (user, accessToken) => {
    const result = await completeCommanderLogin(user, accessToken);
    if (result === true) return true;
    reportLoginFailure('login', result?.error || 'completion failed', { status: result?.status });
    setError(result?.error || 'Sign-In Could Not Be Completed. Please Try Again.');
    return false;
  }, []);

  // Pre-fill email from stored staff data if available (remember me)
  useEffect(() => {
    try {
      const staffData = JSON.parse(localStorage.getItem('commander_staff') || '{}');
      if (staffData.email) setEmail(staffData.email);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    // NOTE: the ?expired=1 message is set by checkExistingSession only when
    // silent recovery fails - setting it here flashed 'Session Expired' at
    // users who were about to be signed straight back in.
    // Show 'no subscription' message for OAuth users who signed in but don't have a Commander account
    if (router.query.no_sub === '1') {
      setError('No Active Club Commander Subscription Found. Please Sign Up Below To Create Your Venue.');
    }

    // -- SSO Bridge Detection ----------------------------------------------
    // Both apps use the storage key 'smarter-poker-auth', so when this page
    // is served through the smarter.poker/commander/* rewrite the hub session
    // is right here in localStorage. On commander.smarter.poker it is not
    // (localStorage is origin-scoped) - that case is handled by the
    // cross-origin bridge in handleSSOContinue.
    try {
      const authRaw = localStorage.getItem('smarter-poker-auth');
      if (authRaw) {
        const auth = JSON.parse(authRaw);
        const userEmail = auth?.user?.email;
        if (userEmail) {
          setSsoEmail(userEmail);
        }
      }
    } catch (e) { /* localStorage may be unavailable */ }
  }, [router.query.expired, router.query.no_sub]); // eslint-disable-line react-hooks/exhaustive-deps

  // -- Cross-origin bridge: hand a hub session to commander.smarter.poker --
  // Runs on the smarter.poker origin (where the hub session lives). Calls the
  // hub SSO endpoint with the local access token and redirects to
  // commander.smarter.poker/auth/sso?token=... which completes the login
  // there. Returns false when there is no local session to bridge.
  const bridgeToCommanderOrigin = useCallback(async () => {
    // getSession() refreshes an expired access token before handing it over;
    // the raw localStorage copy may be an hour stale.
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token || null;
    if (!accessToken) return false;

    const ssoRes = await fetch(`${HUB_ORIGIN}/api/auth/commander-sso`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      credentials: 'include',
    });
    const ssoData = await ssoRes.json().catch(() => ({}));
    if (!ssoRes.ok || !ssoData.url) {
      throw new Error(ssoData.error || 'SSO Failed. Please Sign In With Your Email And Password Below.');
    }
    window.location.href = ssoData.url;
    return true;
  }, []);

  // Auto-restore session - silently sign in whenever a Supabase session exists
  useEffect(() => {
    // 2026-08-20: wait for the router so ?expired=1 is actually readable -
    // running before isReady could miss the expired branch, redirect to the
    // dashboard with the stale staff session, and re-enter the bounce loop.
    if (!router.isReady) return;
    // Show a manual reset button if stuck for > 4s
    const stuckTimeout = setTimeout(() => setShowReset(true), 4000);
    // Force stop checking if stuck for > 8s
    const safetyTimeout = setTimeout(() => setCheckingSession(false), 8000);
    const stopTimers = () => { clearTimeout(safetyTimeout); clearTimeout(stuckTimeout); };

    async function checkExistingSession() {
      try {
        // -- ?bridge=1: we were sent here from commander.smarter.poker to pick
        // up the hub session that only exists on THIS origin. If it is here,
        // hop straight back with a one-time SSO token. If it is not, the user
        // is signed out of the platform entirely - show the form.
        if (router.query.bridge === '1' && isHubOrigin()) {
          try {
            const bridged = await bridgeToCommanderOrigin();
            if (bridged) { stopTimers(); return; }
          } catch (e) {
            console.warn('[SSO] bridge failed:', e?.message || e);
            setError(e?.message || 'SSO Failed. Please Sign In With Your Email And Password Below.');
          }
          stopTimers();
          setCheckingSession(false);
          return;
        }

        // -- ?expired=1: the server rejected the commander staff session --
        // 2026-08-20 FIX: this handler previously wiped 'smarter-poker-auth'
        // (the SHARED hub session) and called supabase.auth.signOut(), logging
        // the user out of the ENTIRE platform whenever the commander staff
        // session lapsed. Only the commander_* state is cleared; if the
        // Supabase session is still valid we silently mint a FRESH signed
        // staff session instead of demanding credentials.
        if (router.query.expired === '1') {
          localStorage.removeItem('commander_staff');
          localStorage.removeItem('commander_venue');
          localStorage.removeItem('commander_subscription');

          // Loop breaker: if a silent recovery was already attempted in the
          // last 60s and we are back here, the server is rejecting even
          // fresh sessions - stop retrying and show the form instead of
          // bouncing dashboard<->login forever.
          let recentAttempt = false;
          try {
            const last = Number(sessionStorage.getItem('commander_expired_recovery_ts') || 0);
            recentAttempt = Date.now() - last < 60 * 1000;
          } catch { /* ignore */ }

          const { data: { session } } = await supabase.auth.getSession();
          let recoveryTried = false;
          if (session?.user && !recentAttempt) {
            try { sessionStorage.setItem('commander_expired_recovery_ts', String(Date.now())); } catch { /* ignore */ }
            stopTimers();
            recoveryTried = true;
            const ok = await completeLogin(session.user, session.access_token).catch(() => false);
            if (ok) return; // redirecting to dashboard with a fresh session
          }
          stopTimers();
          // completeLogin sets its own, more specific error when it fails -
          // only show the generic expiry message when we could not even try
          if (!recoveryTried) setError('Your Session Has Expired. Please Sign In Again.');
          setCheckingSession(false);
          return;
        }

        // -- Silent sign-in whenever a Supabase session exists --
        // If a valid Supabase session exists, complete the commander login
        // automatically - the user should NEVER be asked to re-authenticate
        // while their platform session is alive. A healthy (signed, unexpired)
        // staff session goes straight to the dashboard; anything else is
        // re-minted from the live session first.
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          stopTimers();
          // A healthy staff session is only reusable when it belongs to THIS
          // Supabase user - a different account signed in on the same device
          // must get its own session, not the previous owner's venue.
          if (isStaffSessionHealthy() && readStaffSession()?.user_id === session.user.id) {
            window.location.href = '/commander/dashboard';
            return;
          }
          const ok = await completeLogin(session.user, session.access_token).catch(() => false);
          if (ok) return;
          setCheckingSession(false);
          return;
        }

        // No session - try to refresh (works when a refresh token survives)
        const { data: { session: refreshed } } = await supabase.auth.refreshSession();
        if (refreshed?.user) {
          stopTimers();
          if (isStaffSessionHealthy() && readStaffSession()?.user_id === refreshed.user.id) {
            window.location.href = '/commander/dashboard';
            return;
          }
          const ok = await completeLogin(refreshed.user, refreshed.access_token).catch(() => false);
          if (ok) return;
          setCheckingSession(false);
          return;
        }

        // Refresh failed - keep commander_remember and staff email for pre-fill
        localStorage.removeItem('commander_venue');
        localStorage.removeItem('commander_subscription');
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

      stopTimers();
      setCheckingSession(false);
    }

    checkExistingSession();
    return stopTimers;
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);

    try {
      // Sign in with Supabase
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) throw authError;

      const ok = await completeLogin(data.user, data.session.access_token);
      // completeLogin stores commander_remember=true; honour an unticked box
      // AFTER it has written (the navigation it started is still pending).
      if (!rememberMe) {
        try { localStorage.removeItem('commander_remember'); } catch { /* ignore */ }
      }
      if (ok) return; // navigating
    } catch (err) {
      console.warn('Login error:', err);
      // Wrong password is not an incident; anything else after Supabase
      // answered is (that is exactly what the missing-completeLogin bug was).
      if (!/invalid login credentials/i.test(err?.message || '')) reportLoginFailure('login', err);
      if (err.name === 'AbortError') {
        setError('Login Timed Out. Please Check Your Connection And Try Again.');
      } else {
        setError(err.message || 'Invalid Email Or Password');
      }
    } finally {
      setLoading(false);
    }
  }

  // -- SSO Continue handler ---------------------------------------------
  // "Continue As Smarter.Poker". Three situations:
  //   1. A Supabase session is readable on THIS origin -> complete the
  //      Commander login directly (no round-trip needed).
  //   2. We are on commander.smarter.poker with no local session -> send the
  //      browser to smarter.poker/commander/login?bridge=1, where the hub
  //      session lives; that page mints a one-time SSO token and returns to
  //      commander.smarter.poker/auth/sso to finish.
  //   3. We are already on the hub origin with no session -> nothing to
  //      bridge; the user is signed out of the platform.
  const handleSSOContinue = async () => {
    setError(null);
    setSsoLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && session?.access_token) {
        const ok = await completeLogin(session.user, session.access_token);
        if (ok) return;
        setSsoLoading(false);
        return;
      }

      if (!isHubOrigin()) {
        try { sessionStorage.setItem('commander_return_url', window.location.pathname); } catch { /* ignore */ }
        window.location.href = `${HUB_ORIGIN}/commander/login?bridge=1`;
        return;
      }

      // Hub origin, no session anywhere: the user really is signed out.
      setError('You Are Not Signed In To Smarter.Poker. Please Sign In Below.');
      setSsoLoading(false);
    } catch (err) {
      console.warn('[SSO] Continue error:', err);
      setError('SSO Sign-In Failed. Please Use Email And Password Below.');
      setSsoLoading(false);
    }
  };


  // OAuth return path (/auth/callback redirects here with ?oauth=1 once the
  // Supabase session is established) - finish the subscription check.
  useEffect(() => {
    if (router.query.oauth !== '1') return;
    (async () => {
      try {
        setLoading(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const ok = await completeLogin(session.user, session.access_token);
          if (ok) return;
        } else {
          setError('Sign-In Could Not Be Completed. Please Try Again.');
        }
      } catch (err) {
        console.warn('OAuth completion error:', err);
        setError(err.message || 'Sign-In Could Not Be Completed.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.oauth]);

  async function handleOAuthSignIn(provider) {
    try {
      setLoading(true);
      setError(null);
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/commander/login?oauth=1`,
        },
      });
      if (error) throw error;
    } catch (err) {
      console.warn('OAuth Error:', err);
      setError(err.message || `Failed to sign in with ${provider}`);
      setLoading(false);
    }
  }

  // Show loading while checking for existing session
  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#02050A] flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
        {showReset && (
          <button
            type="button"
            onClick={() => setCheckingSession(false)}
            className="text-xs text-cyan-300 underline"
          >
            Taking Too Long? Sign In Manually
          </button>
        )}
      </div>
    );
  }

  const autofillCss = `
    input:-webkit-autofill,
    input:-webkit-autofill:hover,
    input:-webkit-autofill:focus,
    input:-webkit-autofill:active {
        transition: background-color 9999s ease-in-out 0s;
        -webkit-text-fill-color: white !important;
    }
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: autofillCss}} />
      <div className="w-screen h-screen relative overflow-hidden font-rajdhani bg-black">
        <SEOHead
          title="Club Commander - Sign In"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <div
          className="relative w-full h-full z-10"
        >
          {/* Stretch the image to fill the screen exactly as requested, no black bars, no blur */}
          <img
            src="/images/commander/login-bg-v2.jpg"
            className="absolute inset-0 w-full h-full object-fill pointer-events-none"
            alt="Login Background"
          />

          {/* 1. SSO Bridge Button overlay / Recent Login */}
          <button
            type="button"
            onClick={handleSSOContinue}
            disabled={ssoLoading || loading}
            style={{
              position: 'absolute',
              top: '26.8%',
              left: '23%',
              width: '54%',
              height: '5.5%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 'min(20px, 3.5vw)',
              fontWeight: '600',
              fontFamily: 'Inter, sans-serif'
            }}
            className="hover:bg-white/5 transition-colors rounded-lg"
            title="Continue with SSO"
          >
            {ssoLoading ? 'Signing In...' : 'Continue As ' + (ssoEmail || 'Smarter.Poker')}
          </button>

          {/* 2. Google OAuth Button overlay */}
          <button
            type="button"
            onClick={() => handleOAuthSignIn('google')}
            disabled={loading}
            style={{
              position: 'absolute',
              top: '37.8%',
              left: '26%',
              width: '48%',
              height: '4.5%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10
            }}
            className="hover:bg-white/5 transition-colors rounded-lg"
            title="Continue With Google"
          />

          <form onSubmit={handleSubmit} style={{ display: 'contents' }}>

            {/* 3. Email Input overlay */}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              style={{
                position: 'absolute',
                top: '50.3%',
                left: '32%',
                width: '40%',
                height: '4.5%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'white',
                fontSize: 'min(17px, 3vw)',
                zIndex: 10,
                fontFamily: 'Inter, sans-serif'
              }}
            />

            {/* 4. Password Input overlay */}
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                position: 'absolute',
                top: '58.1%',
                left: '32%',
                width: '35%', // Leave room for eye icon
                height: '4.5%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'white',
                fontSize: 'min(17px, 3vw)',
                zIndex: 10,
                fontFamily: 'Inter, sans-serif'
              }}
            />

            {/* 5. Eye Icon Toggle overlay */}
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                top: '58.1%',
                left: '68%',
                width: '6%',
                height: '4.5%',
                background: '#02050A', // Mask baked-in icon
                border: 'none',
                cursor: 'pointer',
                zIndex: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              className="text-[#8A8D91] hover:text-[#E4E6EB] transition-colors"
              title="Toggle Password Visibility"
            >
              {showPassword ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              )}
            </button>

            {/* 6. Remember Me Checkbox overlay */}
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={{
                position: 'absolute',
                top: '64.5%',
                left: '25%',
                width: '3%',
                height: '2%',
                cursor: 'pointer',
                opacity: 0.01,
                zIndex: 10
              }}
              title="Remember Me"
            />

            {/* 7. Forgot Password Link overlay */}
            <a
              href="#"
              style={{
                position: 'absolute',
                top: '64.5%',
                left: '55%',
                width: '19%',
                height: '2%',
                background: 'transparent',
                cursor: 'pointer',
                zIndex: 10
              }}
              title="Forgot Password"
            />

            {/* 8. Sign In Button overlay */}
            <button
              type="submit"
              disabled={loading}
              style={{
                position: 'absolute',
                top: '68.5%',
                left: '26%',
                width: '48%',
                height: '4.5%',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white'
              }}
              className="hover:bg-white/5 transition-colors rounded-lg"
            title="Sign In"
            >
              {loading && <Loader2 className="w-5 h-5 animate-spin" />}
            </button>
          </form>

          {/* Error Message Display Overlay */}
          {error && (
            <div
              className="animate-in fade-in slide-in-from-bottom-2 duration-300 shadow-xl"
              style={{
                position: 'absolute',
                top: '74%',
                left: '26%',
                width: '48%',
                textAlign: 'center',
                color: '#ff3366',
                backgroundColor: 'rgba(20, 0, 0, 0.95)',
                border: '1px solid rgba(255, 51, 102, 0.3)',
                padding: '8px',
                borderRadius: '6px',
                fontSize: '15px',
                fontWeight: '600',
                zIndex: 20
              }}
            >
              {error}
            </div>
          )}

          {/* 9. Sign Up Button overlay */}
          <Link
            href="/commander/register"
            style={{
              position: 'absolute',
              top: '78%',
              left: '26%',
              width: '48%',
              height: '4.5%',
              background: 'transparent',
              cursor: 'pointer',
              zIndex: 10
            }}
            className="hover:bg-white/5 transition-colors rounded-lg"
            title="Sign Up"
          />
        </div>
      </div>
    </>
  );
}
