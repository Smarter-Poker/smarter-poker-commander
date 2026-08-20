/**
 * Commander Owner/Manager Login Page
 * Email + Password for venue owners
 * SmarterPoker color scheme
 *
 * [2026-08-19] Added SSO bridge: if user is already signed in on smarter.poker
 * (detected via shared 'smarter-poker-auth' localStorage key), a
 * "Continue as [email]" button appears so they never need to re-enter credentials.
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import Link from 'next/link';
import { Loader2, Check } from 'lucide-react';
import { supabase } from '../../src/lib/supabase';

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

  // SSO bridge state - set when smarter.poker session detected in localStorage
  const [ssoEmail, setSsoEmail] = useState(null);
  const [ssoLoading, setSsoLoading] = useState(false);

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

    // ── SSO Bridge Detection ──────────────────────────────────────────
    // Check if the user is already logged into smarter.poker. Both apps
    // use the storage key 'smarter-poker-auth' on Supabase's SDK, so if
    // this Commander tab was opened from within smarter.poker, the shared
    // localStorage key should already have the session.
    // NOTE: This only works when both origins share a parent domain AND
    // the browser allows cross-origin localStorage sharing - which it doesn't.
    // For the common case (cross-origin), the hub passes ?hub_token= in the
    // URL when navigating to Commander, which we use below.
    //
    // Same-origin path (works when Commander is served via smarter.poker/commander/* rewrite):
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

    async function checkExistingSession() {
      try {
        // ── ?expired=1: the server rejected the commander staff session ──
        // 2026-08-20 FIX: this handler previously wiped 'smarter-poker-auth'
        // (the SHARED hub session on the smarter.poker/commander/* path) and
        // called supabase.auth.signOut() (which revokes refresh tokens),
        // logging the user out of the ENTIRE platform whenever the commander
        // staff session lapsed. The staff session and the Supabase session
        // are separate: only the staff session was rejected, so only the
        // commander_* state should be cleared - then, if the Supabase
        // session is still valid, silently mint a FRESH signed staff session
        // via completeLogin instead of demanding credentials. This both
        // breaks the original redirect loop (fresh session = dashboard stops
        // bouncing) and never signs the user out of smarter.poker.
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
            clearTimeout(safetyTimeout);
            clearTimeout(stuckTimeout);
            recoveryTried = true;
            const ok = await completeLogin(session.user, session.access_token).catch(() => false);
            if (ok) return; // redirecting to dashboard with a fresh session
          }
          clearTimeout(safetyTimeout);
          clearTimeout(stuckTimeout);
          // completeLogin sets its own, more specific error when it fails -
          // only show the generic expiry message when we could not even try
          if (!recoveryTried) setError('Your Session Has Expired. Please Sign In Again.');
          setCheckingSession(false);
          return;
        }

        // ── Silent sign-in whenever a Supabase session exists ──
        // 2026-08-20 FIX: previously this path required commander_remember
        // AND commander_staff in localStorage, so a user who was already
        // logged into smarter.poker (same-origin session via the
        // smarter.poker/commander/* rewrite) was still shown the login form.
        // If a valid Supabase session exists, complete the commander login
        // automatically - the user should NEVER be asked to re-authenticate
        // while their platform session is alive. completeLogin surfaces its
        // own error (e.g. no commander subscription) and falls back to the
        // form when it cannot proceed.
        const staffDataRaw = localStorage.getItem('commander_staff');
        let validStaff = false;
        try {
          const parsed = JSON.parse(staffDataRaw || '{}');
          if (parsed.id || parsed.user_id) validStaff = true;
        } catch { }

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          clearTimeout(safetyTimeout);
          clearTimeout(stuckTimeout);
          if (validStaff) {
            // Staff state intact - straight to dashboard
            window.location.href = '/commander/dashboard';
            return;
          }
          // No commander state yet - mint it silently from the live session
          const ok = await completeLogin(session.user, session.access_token).catch(() => false);
          if (ok) return;
          setCheckingSession(false);
          return;
        }

        // No session - try to refresh (works when a refresh token survives)
        const { data: { session: refreshed } } = await supabase.auth.refreshSession();
        if (refreshed?.user) {
          clearTimeout(safetyTimeout);
          clearTimeout(stuckTimeout);
          if (validStaff) {
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

      clearTimeout(safetyTimeout);
      clearTimeout(stuckTimeout);
      setCheckingSession(false);
    }
    
    checkExistingSession();
  }, [router.isReady]);

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

      await completeLogin(data.user, data.session.access_token);
    } catch (err) {
      console.warn('Login error:', err);
      if (err.name === 'AbortError') {
        setError('Login Timed Out. Please Check Your Connection And Try Again.');
      } else {
        setError(err.message || 'Invalid Email Or Password');
      }
    } finally {
      setLoading(false);
    }
  }

  // ── SSO Continue handler ─────────────────────────────────────────────
  // Called when the user clicks "Continue as [email]". Reads their current
  // smarter.poker JWT from localStorage, calls the hub SSO endpoint to get
  // a one-time bridge token, then redirects to /auth/sso on Commander to
  // finish the session transfer.
  const handleSSOContinue = async () => {
    setError(null);
    setSsoLoading(true);
    try {
      // Read the current smarter.poker session token
      let accessToken = null;
      try {
        const authRaw = localStorage.getItem('smarter-poker-auth');
        if (authRaw) {
          const auth = JSON.parse(authRaw);
          accessToken = auth?.access_token;
        }
        // Fallback: check Supabase default storage keys
        if (!accessToken) {
          const sbKeys = Object.keys(localStorage || {}).filter(
            k => k.startsWith('sb-') && k.endsWith('-auth-token')
          );
          if (sbKeys.length > 0) {
            const raw = localStorage.getItem(sbKeys[0]);
            if (raw) {
              const parsed = JSON.parse(raw);
              accessToken = parsed?.access_token;
            }
          }
        }
      } catch (e) { /* localStorage unavailable */ }

      if (!accessToken) {
        // No local token - fall back to supabase.auth.getSession()
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token;
      }

      if (!accessToken) {
        setError('Could Not Read Your Smarter.Poker Session. Please Sign In Manually.');
        setSsoLoading(false);
        return;
      }

      // Call the hub SSO endpoint - this works when Commander is accessed via
      // smarter.poker/commander/* rewrite. When accessed directly at
      // commander.smarter.poker, this URL hits the main hub API.
      const hubOrigin = process.env.NEXT_PUBLIC_MAIN_HUB_URL || 'https://smarter.poker';
      const ssoRes = await fetch(`${hubOrigin}/api/auth/commander-sso`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        credentials: 'include',
      });

      const ssoData = await ssoRes.json().catch(() => ({}));

      if (!ssoRes.ok || !ssoData.url) {
        setError(ssoData.error || 'SSO Failed. Please Sign In With Your Email And Password Below.');
        setSsoLoading(false);
        return;
      }

      // Redirect to Commander SSO landing page with the one-time token
      window.location.href = ssoData.url;
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
          await completeLogin(session.user, session.access_token);
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

  // Show loading while checking for existing session
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

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#02050A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
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
            onClick={ssoEmail ? handleSSOContinue : undefined}
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
            title="Continue With Google"
          />

          <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
            
            {/* 3. Email Input overlay */}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                position: 'absolute',
                top: '50.4%',
                left: '30%',
                width: '42%',
                height: '4.5%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'white',
                fontSize: 'min(17px, 3vw)',
                zIndex: 10,
                fontFamily: 'Inter, sans-serif',
                paddingTop: '0.5%'
              }}
            />

            {/* 4. Password Input overlay */}
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                position: 'absolute',
                top: '58.5%',
                left: '30%',
                width: '37%', // Leave room for eye icon
                height: '4.5%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'white',
                fontSize: 'min(17px, 3vw)',
                zIndex: 10,
                fontFamily: 'Inter, sans-serif',
                paddingTop: '0.5%'
              }}
            />

            {/* 5. Eye Icon Toggle overlay */}
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                top: '58.5%',
                left: '68%',
                width: '6%',
                height: '4.5%',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                zIndex: 11
              }}
              title="Toggle Password Visibility"
            />

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
              title="Sign In"
            >
              {loading && <Loader2 className="w-5 h-5 animate-spin" />}
            </button>
          </form>

          {/* Error Message Display Overlay */}
          {error && (
            <div style={{
              position: 'absolute',
              top: '74%',
              left: '26%',
              width: '48%',
              textAlign: 'center',
              color: '#F02849',
              backgroundColor: 'rgba(0,0,0,0.8)',
              padding: '4px',
              borderRadius: '4px',
              fontSize: '14px',
              zIndex: 10
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
            title="Sign Up"
          />
        </div>
      </div>
    </>
  );
}
