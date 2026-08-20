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
import { Loader2, Eye, EyeOff, ArrowRight, Mail, Lock, ChevronRight, UserPlus, ShieldCheck, AlertCircle, Check } from 'lucide-react';
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
    return (
    <div className="min-h-screen bg-[#050914] flex flex-col items-center justify-center p-4 relative overflow-hidden font-rajdhani">
      {/* Dynamic Background Effects */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[radial-gradient(circle,rgba(0,120,255,0.05)_0%,rgba(0,0,0,0)_70%)]"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[1200px] rounded-full bg-[radial-gradient(circle,rgba(0,212,255,0.02)_0%,rgba(0,0,0,0)_60%)]"></div>
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(0, 212, 255, 0.1) 1px, transparent 1px)', backgroundSize: '40px 40px', opacity: 0.2 }}></div>
      </div>

      <SEOHead
        title="Club Commander - Sign In"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        {/* Futuristic Metal Logo */}
        <div className="mb-8 w-full relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-[#00D4FF]/0 via-[#00D4FF]/20 to-[#00D4FF]/0 blur-lg opacity-50 group-hover:opacity-100 transition duration-1000"></div>
          <div className="relative w-full border-[3px] border-[#2a3a4a] bg-gradient-to-b from-[#1a2332] to-[#0d1117] p-4 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_20px_rgba(0,212,255,0.1)] flex flex-col items-center justify-center overflow-hidden" style={{ clipPath: 'polygon(5% 0, 95% 0, 100% 15%, 100% 85%, 95% 100%, 5% 100%, 0 85%, 0 15%)' }}>
            {/* Corner Accents */}
            <div className="absolute top-1 left-1 w-3 h-3 border-t-2 border-l-2 border-[#00D4FF]/50"></div>
            <div className="absolute top-1 right-1 w-3 h-3 border-t-2 border-r-2 border-[#00D4FF]/50"></div>
            <div className="absolute bottom-1 left-1 w-3 h-3 border-b-2 border-l-2 border-[#00D4FF]/50"></div>
            <div className="absolute bottom-1 right-1 w-3 h-3 border-b-2 border-r-2 border-[#00D4FF]/50"></div>
            
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-b from-white via-gray-300 to-gray-500 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] text-center font-orbitron uppercase" style={{ filter: 'drop-shadow(0 0 10px rgba(0,212,255,0.3))' }}>
              Club<br />Commander
            </h1>
            <div className="flex items-center gap-3 mt-3 w-full justify-center">
              <div className="h-[1px] w-12 bg-gradient-to-r from-transparent to-[#00D4FF]/50"></div>
              <p className="text-[10px] tracking-[0.2em] text-[#00D4FF] uppercase font-semibold">
                Powered by Smarter.Poker
              </p>
              <div className="h-[1px] w-12 bg-gradient-to-l from-transparent to-[#00D4FF]/50"></div>
            </div>
          </div>
        </div>

        {/* Main Panel */}
        <div className="w-full bg-[#030812]/80 backdrop-blur-md rounded-2xl p-6 sm:p-8 border border-[#00D4FF]/30 shadow-[0_0_40px_rgba(0,150,255,0.15),inset_0_0_20px_rgba(0,212,255,0.05)]">
          
          {/* SSO Bridge Button */}
          {ssoEmail && (
            <div className="mb-6">
              <button
                type="button"
                onClick={handleSSOContinue}
                disabled={ssoLoading || loading}
                className="w-full bg-gradient-to-r from-[#071b36] to-[#041022] hover:from-[#0a2448] hover:to-[#06152d] border border-[#00D4FF]/40 disabled:opacity-60 text-white py-3 px-4 rounded-xl flex items-center justify-between transition-all shadow-[0_0_15px_rgba(0,212,255,0.1)] group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-[#0070f3] flex items-center justify-center font-bold text-sm shadow-[0_0_10px_rgba(0,112,243,0.8)] group-hover:shadow-[0_0_15px_rgba(0,112,243,1)] transition-shadow">
                    SP
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="text-xs text-[#00D4FF]/70 uppercase tracking-wider font-semibold">Continue As</span>
                    <span className="text-sm font-medium truncate max-w-[180px]">{ssoEmail}</span>
                  </div>
                </div>
                {ssoLoading ? (
                  <Loader2 className="w-5 h-5 text-[#00D4FF] animate-spin" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-[#00D4FF] group-hover:translate-x-1 transition-transform" />
                )}
              </button>
              
              <div className="relative my-6 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-[#1a3a5a] to-transparent"></div>
                </div>
                <span className="relative px-4 bg-[#030812] text-[#4a6a8a] text-xs font-semibold tracking-widest uppercase">Or</span>
              </div>
            </div>
          )}

          {/* Social Sign-In Buttons */}
          <div className="mb-6">
            <button
              type="button"
              onClick={() => handleOAuthSignIn('google')}
              disabled={loading}
              className="w-full bg-white hover:bg-gray-100 text-[#3c4043] font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-colors border border-transparent hover:border-gray-300 shadow-md"
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

          <div className="relative my-6 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-[#1a3a5a] to-transparent"></div>
            </div>
            <span className="relative px-4 bg-[#030812] text-[#4a6a8a] text-xs font-semibold tracking-widest uppercase">Or Sign In With Email</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-[#E4E6EB] text-sm font-medium mb-2 pl-1">
                Email Address
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="w-5 h-5 text-[#4a6a8a] group-focus-within:text-[#00D4FF] transition-colors" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#050b14] border border-[#1a3a5a] rounded-xl pl-11 pr-4 py-3.5 text-[#E4E6EB] placeholder-[#3a5a7a] focus:outline-none focus:border-[#00D4FF] focus:shadow-[0_0_15px_rgba(0,212,255,0.2)] transition-all"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-[#E4E6EB] text-sm font-medium mb-2 pl-1">
                Password
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="w-5 h-5 text-[#4a6a8a] group-focus-within:text-[#00D4FF] transition-colors" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#050b14] border border-[#1a3a5a] rounded-xl pl-11 pr-12 py-3.5 text-[#E4E6EB] placeholder-[#3a5a7a] focus:outline-none focus:border-[#00D4FF] focus:shadow-[0_0_15px_rgba(0,212,255,0.2)] transition-all"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4a6a8a] hover:text-[#00D4FF] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Extras Row */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 opacity-0 absolute inset-0 cursor-pointer z-10"
                  />
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${rememberMe ? 'bg-[#0070f3] border-[#0070f3]' : 'bg-[#050b14] border-[#1a3a5a]'}`}>
                    {rememberMe && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </div>
                </div>
                <label htmlFor="rememberMe" className="text-[#B0B3B8] text-sm cursor-pointer select-none hover:text-white transition-colors">
                  Remember Me
                </label>
              </div>
              <a href="#" className="text-[#0070f3] hover:text-[#00D4FF] text-sm font-medium transition-colors">
                Forgot Password?
              </a>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-[#F02849]/10 border border-[#F02849]/30 text-[#F02849] px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full relative group overflow-hidden bg-gradient-to-b from-[#0a2540] to-[#041022] hover:from-[#0f3560] hover:to-[#081b36] border-[2px] border-[#0070f3] disabled:border-[#1a3a5a] disabled:opacity-70 text-white font-bold tracking-widest text-lg uppercase py-3.5 px-6 rounded-xl transition-all shadow-[0_0_20px_rgba(0,112,243,0.3)] hover:shadow-[0_0_30px_rgba(0,212,255,0.5)] flex items-center justify-center gap-2 mt-4"
              style={{ clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)' }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#00D4FF]/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-8 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-[#1a3a5a] to-transparent"></div>
            </div>
            <span className="relative px-4 bg-[#030812] text-[#4a6a8a] text-xs font-semibold tracking-widest uppercase">New To Club Commander?</span>
          </div>

          {/* Sign Up Link */}
          <Link
            href="/commander/register"
            className="w-full bg-[#050b14] hover:bg-[#0a1526] border border-[#1a3a5a] hover:border-[#2a5a8a] text-[#E4E6EB] font-semibold py-3.5 px-6 rounded-xl text-center transition-colors flex items-center justify-center gap-2"
          >
            <UserPlus className="w-5 h-5 text-[#8A8D91]" />
            Sign Up
          </Link>
          
          <div className="mt-8 flex items-center justify-center gap-2 text-[#4a6a8a]">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-xs font-medium tracking-wide">Secure. Encrypted. Trusted.</span>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[#4a6a8a] text-xs font-medium tracking-widest uppercase mt-8 pb-4">
          Powered By <span className="text-[#0070f3] font-bold">SMARTER.POKER</span>
        </p>
      </div>
      
      {/* Global Styles for specific fonts if not present */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Rajdhani:wght@400;500;600;700&display=swap');
        .font-orbitron { font-family: 'Orbitron', sans-serif; }
        .font-rajdhani { font-family: 'Rajdhani', sans-serif; }
      `}</style>
    </div>
  );
}