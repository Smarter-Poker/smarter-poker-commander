/**
 * Commander staff-session lifecycle - the ONE place a Supabase user becomes a
 * Commander staff session.
 *
 * [2026-09-03] Root-cause fix for "Commander asks me to sign in again and
 * then will not accept the login":
 *
 *   pages/commander/login.js called `completeLogin(user, token)` from every
 *   path (password, Google OAuth, silent restore, ?expired=1 recovery) but the
 *   function was no longer defined anywhere in the file. Every login attempt
 *   therefore threw `ReferenceError: completeLogin is not defined` AFTER
 *   Supabase had already accepted the credentials, and the page showed that
 *   ReferenceError text as the login error. pages/auth/sso.js carried its own
 *   private copy (completeCommanderLogin) - the two had drifted apart.
 *
 * This module (vendored in commander-shared, shimmed at src/lib/commander/
 * staffSession.js) is imported by login.js, auth/sso.js, the dashboard guard and
 * commanderFetch's 401 self-heal, so the staff session can never again be
 * minted in one place and rejected by another.
 *
 * Everything here is browser-only and dependency-free apart from `fetch` +
 * localStorage, so the vendored commander-shared package can call
 * `refreshStaffSession()` without importing the Supabase client.
 */

const OWNER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // matches src/lib/commander/auth.js
// Re-mint before the server would reject the session, not after.
const PROACTIVE_REFRESH_AFTER_MS = OWNER_SESSION_TTL_MS - 12 * 60 * 60 * 1000;

const OWNER_PERMISSIONS = {
  manage_games: true,
  manage_waitlist: true,
  manage_staff: true,
  manage_tables: true,
  manage_tournaments: true,
  manage_settings: true,
  view_analytics: true,
  view_reports: true,
  send_announcements: true,
};

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

/** Parsed `commander_staff` or null. */
export function readStaffSession() {
  try {
    const parsed = JSON.parse(lsGet('commander_staff') || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * True when the stored staff session will be accepted by the server:
 * signed, and inside the owner TTL (PIN sessions carry `id` and are the
 * terminal's business - never touched here).
 */
export function isStaffSessionHealthy(staff = readStaffSession()) {
  if (!staff) return false;
  if (staff.id) return true; // PIN terminal session - not ours to refresh
  if (!staff.sig || !staff.session_ts) return false;
  if (Date.now() - Number(staff.session_ts) > PROACTIVE_REFRESH_AFTER_MS) return false;
  return !!(staff.user_id && staff.venue_id);
}

/**
 * Read the current Supabase access token straight from localStorage.
 * Mirrors clientAuth.getToken() so this file has no import on the vendor
 * package (and vice versa).
 */
export function readAccessToken() {
  const unified = lsGet('smarter-poker-auth');
  if (unified) {
    try { const p = JSON.parse(unified); if (p?.access_token) return p.access_token; } catch { /* ignore */ }
  }
  try {
    const sbKeys = Object.keys(localStorage || {}).filter(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
    );
    for (const k of sbKeys) {
      const raw = lsGet(k);
      if (!raw) continue;
      try { const p = JSON.parse(raw); if (p?.access_token) return p.access_token; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return '';
}

// ── Live token provider ─────────────────────────────────────────────────────
// readAccessToken() returns whatever the SDK last wrote to localStorage. After
// a tab sits idle past the 1-hour JWT expiry that token is dead and every
// re-mint fails with 401 "Invalid token" - the self-heal heals nothing. The
// SDK knows how to refresh it, but this module is dependency-free (it lives
// in the vendored package), so the app registers a provider instead:
//
//   setAccessTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token)
//
// currentAccessToken() prefers the provider (fresh token, refreshed on demand)
// and falls back to the raw localStorage read when none is registered or the
// provider throws.
let _tokenProvider = null;

export function setAccessTokenProvider(fn) {
  _tokenProvider = typeof fn === 'function' ? fn : null;
}

export async function currentAccessToken() {
  if (_tokenProvider) {
    try {
      const t = await _tokenProvider();
      if (typeof t === 'string' && t) return t;
    } catch { /* fall back to the cached token */ }
  }
  return readAccessToken();
}

/** The Supabase user object cached in localStorage by the SDK, or null. */
export function readAuthUser() {
  const unified = lsGet('smarter-poker-auth');
  if (unified) {
    try { const p = JSON.parse(unified); if (p?.user?.id) return p.user; } catch { /* ignore */ }
  }
  return null;
}

/**
 * Persist the server-issued subscription + signed staff session.
 * `user` may be partial ({ id, email, user_metadata }) - only used for
 * display fields.
 */
export function storeCommanderSession({ subscription, staff_session, user }) {
  const previous = readStaffSession() || {};
  const email = user?.email || previous.email || null;

  lsSet('commander_venue', JSON.stringify(subscription.venue || { id: subscription.venue_id }));
  lsSet('commander_subscription', JSON.stringify(subscription));

  const staffSession = {
    ...(staff_session || {
      user_id: user?.id || previous.user_id,
      role: 'owner',
      venue_id: subscription.venue_id,
    }),
    email,
    display_name:
      subscription.billing_name ||
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      previous.display_name ||
      email,
    venue_name: subscription.venue?.name || previous.venue_name || 'My Venue',
    // Owner sessions always carry the full permission set; the server
    // enforces the real role on every request regardless of this field.
    permissions: OWNER_PERMISSIONS,
  };

  lsSet('commander_staff', JSON.stringify(staffSession));
  lsSet('commander_remember', 'true');
  if (subscription.venue_id !== undefined && subscription.venue_id !== null) {
    lsSet('commander_active_venue_id', String(subscription.venue_id));
  }
  try {
    sessionStorage.removeItem('commander_accounts_cache');
    sessionStorage.removeItem('commander_accounts_v2_cache');
  } catch { /* ignore */ }

  return staffSession;
}

/**
 * Exchange a live Supabase access token for a signed Commander staff session.
 *
 * @returns {Promise<{ok: true, staff: object, subscription: object} |
 *                   {ok: false, status: number, error: string}>}
 */
export async function mintStaffSession(accessToken, { user, preferredVenueId, timeoutMs = 15000 } = {}) {
  if (!accessToken) return { ok: false, status: 0, error: 'No Smarter.Poker session token available.' };

  const venuePref = preferredVenueId ?? lsGet('commander_active_venue_id') ?? null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch('/api/commander/check-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ userId: user?.id, preferred_venue_id: venuePref }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      error: err?.name === 'AbortError'
        ? 'Login Timed Out. Please Check Your Connection And Try Again.'
        : 'Could Not Reach Club Commander. Please Try Again.',
    };
  }
  clearTimeout(timer);

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.subscription) {
    let error = data.error;
    if (!error) {
      error = res.status === 404
        ? 'No Active Club Commander Subscription Found For This Account. Please Sign Up.'
        : res.status === 429
          ? 'Too Many Sign-In Attempts. Please Wait A Moment And Try Again.'
          : 'Could Not Verify Your Club Commander Subscription.';
    }
    return { ok: false, status: res.status, error };
  }

  const staff = storeCommanderSession({
    subscription: data.subscription,
    staff_session: data.staff_session,
    user,
  });
  return { ok: true, staff, subscription: data.subscription };
}

/**
 * Where to send the user after a successful login. Honors the return URL
 * stashed by commanderFetch / CommanderLayout before a redirect.
 */
export function consumeReturnUrl(fallback = '/commander/dashboard') {
  try {
    const returnUrl = sessionStorage.getItem('commander_return_url');
    sessionStorage.removeItem('commander_return_url');
    if (
      returnUrl &&
      returnUrl.startsWith('/commander/') &&
      !returnUrl.startsWith('/commander/login')
    ) {
      return returnUrl;
    }
  } catch { /* ignore */ }
  return fallback;
}

/**
 * Full login completion used by the login and SSO pages: mint the staff
 * session and, on success, navigate to the dashboard (or the return URL).
 *
 * Resolves `true` when a navigation has been started, otherwise
 * `{ ok: false, error }` so the caller can show the message.
 */
export async function completeCommanderLogin(user, accessToken, opts = {}) {
  const result = await mintStaffSession(accessToken, { ...opts, user });
  if (!result.ok) return result;
  try { lsSet('commander_login_origin', window.location.origin); } catch { /* ignore */ }
  const dest = opts.redirectTo || consumeReturnUrl();
  if (typeof window !== 'undefined') window.location.href = dest;
  return true;
}

// -- Silent self-heal --------------------------------------------------------
//
// Called by commanderFetch when a guarded API answers 401 and by the
// dashboard guard when the stored session looks stale. One in-flight refresh
// at a time, with a short cooldown, so a page full of polling panels cannot
// stampede /api/commander/check-subscription (per-IP rate limit).

let _refreshPromise = null;
let _lastRefreshAt = 0;
const REFRESH_COOLDOWN_MS = 20 * 1000;

/**
 * Re-mint `commander_staff` from the live Supabase session.
 * @param {{ force?: boolean }} opts
 * @returns {Promise<boolean>} true when a fresh signed session was stored
 */
export function refreshStaffSession({ force = false } = {}) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (_refreshPromise) return _refreshPromise;

  const existing = readStaffSession();
  // PIN terminals authenticate with their PIN, not a Supabase user - a 401
  // there means the PIN session lapsed, and only the floor can fix that.
  if (existing?.id && !existing?.user_id) return Promise.resolve(false);

  if (!force && Date.now() - _lastRefreshAt < REFRESH_COOLDOWN_MS) return Promise.resolve(false);
  _lastRefreshAt = Date.now();

  _refreshPromise = (async () => {
    try {
      const token = await currentAccessToken();
      if (!token) return false;
      const authUser = readAuthUser();
      // The venue the client believes it is in wins. CommanderLayout's club
      // switcher rewrites venue_id on the stored session (which is what broke
      // its signature in the first place); honouring that here turns the
      // resulting 401 into a correctly re-signed session for the club the
      // user actually picked instead of silently snapping back to the old one.
      const preferredVenueId = existing?.venue_id ?? lsGet('commander_active_venue_id') ?? null;
      const result = await mintStaffSession(token, {
        user: authUser || (existing?.user_id ? { id: existing.user_id, email: existing.email } : undefined),
        preferredVenueId,
      });
      if (result.ok) {
        try {
          window.dispatchEvent(new CustomEvent('commander:staff-session-refreshed', {
            detail: { venue_id: result.staff.venue_id },
          }));
        } catch { /* ignore */ }
        return true;
      }
      // A real "no subscription" answer means re-minting can never succeed;
      // clear the dead commander state so the login page shows the truth.
      if (result.status === 404) {
        lsRemove('commander_venue');
        lsRemove('commander_subscription');
      }
      return false;
    } catch (err) {
      console.warn('[commander-auth] staff session refresh failed:', err?.message || err);
      return false;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}
