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
import Image from 'next/image';
import SEOHead from '../../src/components/seo/SEOHead';
import Link from 'next/link';
import { Loader2, Eye, EyeOff, ArrowRight } from 'lucide-react';
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

  // SSO bridge state — set when smarter.poker session detected in localStorage
  const [ssoEmail, setSsoEmail] = useState(null);
  const [ssoLoading, setSsoLoading] = useState(false);

  // Pre-fill email from stored staff data if available (remember me)
  useEffect(() => {
    try {
      const staffData = JSON.parse(localStorage.getItem('commander_staff') || '{}');
      if (staffData.email) setEmail(staffData.email);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    // Show 'session expired' message if redirected from expired session
    if (router.query.expired === '1') {
      setError('Your session has expired. Please sign in again.');
    }
    // Show 'no subscription' message for OAuth users who signed in but don't have a Commander account
    if (router.query.no_sub === '1') {
      setError('No active Club Commander subscription found. Please sign up below to create your venue.');
    }

    // ── SSO Bridge Detection ──────────────────────────────────────────
    // Check if the user is already logged into smarter.poker. Both apps
    // use the storage key 'smarter-poker-auth' on Supabase's SDK, so if
    // this Commander tab was opened from within smarter.poker, the shared
    // localStorage key should already have the session.
    // NOTE: This only works when both origins share a parent domain AND
    // the browser allows cross-origin localStorage sharing — which it doesn't.
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


  // Auto-restore session — if user has valid Supabase session + remember flag, skip login
  useEffect(() => {
    // Show a manual reset button if stuck for > 4s
    const stuckTimeout = setTimeout(() => setShowReset(true), 4000);
    // Force stop checking if stuck for > 8s
    const safetyTimeout = setTimeout(() => setCheckingSession(false), 8000);

    async function checkExistingSession() {
      try {
        const remembered = localStorage.getItem('commander_remember');
        const staffDataRaw = localStorage.getItem('commander_staff');
        
        // Ensure there is actually a user payload, not just an empty object
        let validStaff = false;
        try {
          const parsed = JSON.parse(staffDataRaw || '{}');
          if (parsed.id || parsed.user_id) validStaff = true;
        } catch { }

        if (!remembered || !validStaff) { 
          clearTimeout(safetyTimeout); 
          clearTimeout(stuckTimeout);
          setCheckingSession(false); 
          return; 
        }

        // Verify Supabase session is still valid
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          clearTimeout(safetyTimeout);
          clearTimeout(stuckTimeout);
          // Session valid AND staff data is valid — go straight to dashboard
          window.location.href = '/commander/dashboard';
          return;
        }

        // Session expired — try to refresh
        const { data: { session: refreshed } } = await supabase.auth.refreshSession();
        if (refreshed) {
          clearTimeout(safetyTimeout);
          clearTimeout(stuckTimeout);
          window.location.href = '/commander/dashboard';
          return;
        }

        // Refresh failed — keep commander_remember and staff email for pre-fill
        localStorage.removeItem('commander_venue');
        localStorage.removeItem('commander_subscription');
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
      
      clearTimeout(safetyTimeout);
      clearTimeout(stuckTimeout);
      setCheckingSession(false);
    }
    
    checkExistingSession();
    return () => {
      clearTimeout(safetyTimeout);
      clearTimeout(stuckTimeout);
    };
  }, [router]);

  // Handle OAuth sign in (Google)
  const handleOAuthSignIn = async (provider) => {
    setError(null);
    setLoading(true);
    try {
      // Store flag so callback knows to redirect to commander
      localStorage.setItem('commander_login_origin', 'true');

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback` } });
      if (error) throw error;
    } catch (err) {
      console.warn(`${provider} sign in error:`, err);
      setError(err.message || `Failed to sign in with ${provider}`);
      setLoading(false);
    }
  };

  // Shared post-auth completion: subscription check + signed staff session
  // storage + redirect. Used by password login AND the OAuth return path.
  async function completeLogin(user, accessToken) {
      const data = { user, session: { access_token: accessToken } };
      // HARDENED: 15-second timeout on subscription check
      const abortController = new AbortController();
      const fetchTimeout = setTimeout(() => abortController.abort(), 15000);

      // Check if user has a commander subscription (server-side to bypass RLS)
      // CRITICAL FIX: Send JWT Bearer token — check-subscription requires auth (BUG #260)
      // 2026-07-25 audit fix: use the /api/commander/* path so this works on
      // BOTH origins (bare /api/check-subscription 404'd when the login page
      // was served through the smarter.poker/commander proxy), and parse the
      // response body before throwing so real error messages surface.
      const subRes = await fetch('/api/commander/check-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ userId: data.user.id }),
        signal: abortController.signal });
      clearTimeout(fetchTimeout);
      const subData = await subRes.json().catch(() => ({}));

      if (!subRes.ok || !subData.subscription) {
        setError(subData.error || 'No active Club Commander subscription found for this account.');
        setLoading(false);
        return false;
      }

      const subscription = subData.subscription;

      // Store venue info and staff session for dashboard access
      localStorage.setItem('commander_venue', JSON.stringify(subscription.venue));
      localStorage.setItem('commander_subscription', JSON.stringify(subscription));

      // Dashboard checks for commander_staff — the server now returns an
      // HMAC-SIGNED owner session (2026-07-25 audit fix). Merge display
      // extras locally but NEVER touch the signed fields
      // (user_id/venue_id/role/session_ts/sig) or the signature breaks.
      const staffSession = {
        ...(subData.staff_session || {
          user_id: data.user.id,
          role: 'owner',
          venue_id: subscription.venue_id,
        }),
        email: data.user.email,
        display_name: subscription.billing_name || data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email,
        venue_name: subscription.venue?.name || 'My Venue',
        permissions: {
          manage_games: true,
          manage_waitlist: true,
          manage_staff: true,
          manage_tables: true,
          manage_tournaments: true,
          manage_settings: true,
          view_analytics: true,
          view_reports: true,
          send_announcements: true }
      };
      localStorage.setItem('commander_staff', JSON.stringify(staffSession));

      // Persist session across browser restarts if "Remember Me" is checked
      if (rememberMe) {
        localStorage.setItem('commander_remember', 'true');
      } else {
        localStorage.removeItem('commander_remember');
      }

      // Use window.location for guaranteed redirect (router.replace can silently fail)
      // Check for stored return URL (set by commanderFetch on 401 session expiry)
      let redirectTo = '/commander/dashboard';
      try {
        const returnUrl = sessionStorage.getItem('commander_return_url');
        if (returnUrl && returnUrl.startsWith('/commander/')) {
          redirectTo = returnUrl;
          sessionStorage.removeItem('commander_return_url');
        }
      } catch { /* sessionStorage may be unavailable */ }
      window.location.href = redirectTo;
      return true;
  }

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
        setError('Login timed out. Please check your connection and try again.');
      } else {
        setError(err.message || 'Invalid email or password');
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
        // No local token — fall back to supabase.auth.getSession()
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token;
      }

      if (!accessToken) {
        setError('Could not read your Smarter.Poker session. Please sign in manually.');
        setSsoLoading(false);
        return;
      }

      // Call the hub SSO endpoint — this works when Commander is accessed via
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
        setError(ssoData.error || 'SSO failed. Please sign in with your email and password below.');
        setSsoLoading(false);
        return;
      }

      // Redirect to Commander SSO landing page with the one-time token
      window.location.href = ssoData.url;
    } catch (err) {
      console.warn('[SSO] Continue error:', err);
      setError('SSO sign-in failed. Please use email and password below.');
      setSsoLoading(false);
    }
  };


  // OAuth return path (/auth/callback redirects here with ?oauth=1 once the
  // Supabase session is established) — finish the subscription check.
  useEffect(() => {
    if (router.query.oauth !== '1') return;
    (async () => {
      try {
        setLoading(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await completeLogin(session.user, session.access_token);
        } else {
          setError('Sign-in could not be completed. Please try again.');
        }
      } catch (err) {
        console.warn('OAuth completion error:', err);
        setError(err.message || 'Sign-in could not be completed.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.oauth]);

  // Show loading while checking for existing session
  if (checkingSession) return (
    <div className="min-h-screen bg-[#18191A] flex flex-col items-center justify-center p-4">
      <div className="text-[#8A8D91] text-sm flex items-center gap-2 mb-4">
        <Loader2 className="w-5 h-5 animate-spin" />
        Restoring Session...
      </div>
      {showReset && (
        <button
          onClick={() => {
            localStorage.removeItem('commander_staff');
            localStorage.removeItem('commander_remember');
            localStorage.removeItem('commander-auth');
            setCheckingSession(false);
          }}
          className="text-xs text-[#EF4444] border border-[#EF444440] rounded px-4 py-2 hover:bg-[#EF444410] transition-colors"
        >
          Reset Session & Sign In
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center p-4">
      <SEOHead
        title="Club Commander — Sign In"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <Image src="/images/club-commander-logo.jpg" alt="Club Commander" width={1584} height={656} className="w-full max-w-sm mx-auto rounded-lg" />
        </div>

        {/* Login Form */}
        <div className="bg-[#242526] rounded-xl p-8 border border-[#3A3B3C]">

          {/* ── SSO Bridge Button ── */}
          {/* Shown when user is already logged into smarter.poker (same-origin/rewrite case)
              or when navigator from the hub passes their session via localStorage sharing. */}
          {ssoEmail && (
            <div className="mb-4">
              <button
                type="button"
                onClick={handleSSOContinue}
                disabled={ssoLoading || loading}
                className="w-full bg-gradient-to-r from-[#1877F2] to-[#0d6ae0] hover:from-[#1664d9] hover:to-[#0a5ec0] disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-3 transition-all shadow-lg shadow-blue-500/20"
              >
                {ssoLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Signing In…</span>
                  </>
                ) : (
                  <>
                    {/* Smarter.Poker logo mark */}
                    <span className="text-lg font-bold tracking-tight">SP</span>
                    <span className="flex flex-col text-left leading-tight">
                      <span className="text-xs text-blue-200 font-normal">Continue as</span>
                      <span className="truncate max-w-[220px]">{ssoEmail}</span>
                    </span>
                    <ArrowRight className="w-4 h-4 ml-auto flex-shrink-0" />
                  </>
                )}
              </button>
              <p className="text-center text-[#8A8D91] text-xs mt-2">
                Using your Smarter.Poker account
              </p>
            </div>
          )}

          {/* Social Sign-In Buttons */}
          <div className="mb-6">
            <button
              type="button"
              onClick={() => handleOAuthSignIn('google')}
              disabled={loading}
              className="w-full bg-white hover:bg-gray-100 text-[#3c4043] font-medium py-3 px-4 rounded-lg flex items-center justify-center gap-3 transition-colors border border-gray-300"
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span>Continue With Google</span>
            </button>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#3A3B3C]"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-[#242526] text-[#B0B3B8]">Or Sign In With Email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-[#E4E6EB] text-sm font-medium mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#3A3B3C] border border-[#4E4F50] rounded-lg px-4 py-3 text-[#E4E6EB] placeholder-[#8A8D91] focus:outline-none focus:border-[#1877F2]"
                placeholder="you@example.com"
                required
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[#E4E6EB] text-sm font-medium mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#3A3B3C] border border-[#4E4F50] rounded-lg px-4 py-3 text-[#E4E6EB] placeholder-[#8A8D91] focus:outline-none focus:border-[#1877F2] pr-12"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8D91] hover:text-[#E4E6EB]"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-[#4E4F50] bg-[#3A3B3C] text-[#1877F2] focus:ring-[#1877F2] focus:ring-offset-0 cursor-pointer accent-[#1877F2]"
              />
              <label htmlFor="rememberMe" className="text-[#B0B3B8] text-sm cursor-pointer select-none">
                Remember Me
              </label>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-[#F02849]/10 border border-[#F02849]/30 text-[#F02849] px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#1877F2] hover:bg-[#1664d9] disabled:bg-[#3A3B3C] text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Signing In...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#3A3B3C]"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-[#242526] text-[#B0B3B8]">New To Club Commander?</span>
            </div>
          </div>

          {/* Sign Up Link */}
          <Link
            href="/commander/register"
            className="block w-full bg-[#3A3B3C] hover:bg-[#4E4F50] text-[#E4E6EB] font-semibold py-3 px-6 rounded-lg text-center transition-colors"
          >
            Sign Up
          </Link>
        </div>

        {/* Footer */}
        <p className="text-center text-[#65676B] text-xs mt-6">
          Powered by SMARTER.POKER
        </p>
      </div>
    </div>
  );
}
