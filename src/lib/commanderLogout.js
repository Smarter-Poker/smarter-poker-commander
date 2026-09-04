/**
 * COMMANDER SIGN-OUT — one implementation, used by every surface that offers it.
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026-09-04. "Sign Out silently fails."
 *
 * Sign Out existed in exactly one of Commander's two headers. CommanderLayout
 * had it; StandaloneGlobalHeader — the header `pages/_app.js` mounts on the 29
 * routes in COMMANDER_ROUTES_WITHOUT_SHARED_LAYOUT, including the waitlist desk,
 * the kiosk, the lobby and every report — had no sign-out control at all. An
 * operator on those routes could not sign out without navigating away first.
 *
 * The one that did exist was not safe either. What it got wrong, and what this
 * function gets right:
 *
 *  - supabase.auth.signOut() REPORTS FAILURE BY RETURN VALUE. GoTrue resolves
 *    with { error } rather than throwing for anything that is not 401/403/404
 *    (offline, 5xx, the 429 saturation this repo hit on 2026-09-01), and on that
 *    path it returns before _removeSession(). A try/catch around it is decorative.
 *    So we never depend on it: the local clear below runs on every path and is
 *    what actually ends the session.
 *
 *  - THE SERVER-SIDE PIN GRANT NEEDS A SERVER CALL. `commander_admin_session` is
 *    HttpOnly with a 30-minute TTL. /api/admin/pin-logout was written to clear it
 *    and had no caller in the repo, so on a shared floor terminal the next person
 *    walked into /commander/admin/* with no PIN.
 *
 *  - THE PATH PREFIX MATTERS. /api/commander/* resolves on both origins
 *    (next.config.js rewrites it to /api/* here; the World Hub's vercel.json
 *    forwards the same prefix). A bare /api/* 404s whenever Commander is reached
 *    through smarter.poker.
 *
 * Keep in step with CommanderLayout.handleLogout, which cannot import this file
 * (it lives in vendor/commander-shared and must not depend on app code).
 * tests/integrity/sign-out-contract.test.mjs fails if the two drift.
 */

/** localStorage keys that must not survive a sign-out. */
export const LOGOUT_LOCAL_KEYS = [
  // The platform session itself.
  'smarter-poker-auth',
  'sp-cached-header-user',
  // Commander's own session state.
  'commander_staff',
  'commander_venue',
  'commander_subscription',
  'commander_remember',
  'commander_security_gate',
  'commander_login_origin',
  'commander_branding',
  'commander_active_venue_id',
  'commander_expired_recovery_ts',
  'club_page_popup_dismissed',
];

/** sessionStorage keys that must not survive a sign-out. */
export const LOGOUT_SESSION_KEYS = [
  // Read by the Switch Account drawer before any auth check, so the next user
  // saw the previous user's club list.
  'commander_accounts_v2_cache',
  'commander_nav_history',
];

/** Marker read once by pages/commander/login.js, which then deletes it. */
export const EXPLICIT_LOGOUT_KEY = 'commander_explicit_logout';

/** Clear every trace of the session from this device. Never throws. */
export function clearCommanderSessionStorage() {
  try {
    LOGOUT_LOCAL_KEYS.forEach((k) => localStorage.removeItem(k));
    Object.keys(localStorage || {})
      .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) { console.warn('[commanderLogout] localStorage:', e?.message || e); }

  try {
    Object.keys(sessionStorage || {}).forEach((k) => {
      if (k.startsWith('pin_unlock_')) sessionStorage.removeItem(k);
    });
    LOGOUT_SESSION_KEYS.forEach((k) => sessionStorage.removeItem(k));
    // Tells login.js to stand down for exactly one load. Without it, the silent
    // sign-in there re-mints the staff session from a surviving Supabase session
    // and bounces straight back to the dashboard — the "nothing happened" bug.
    sessionStorage.setItem(EXPLICIT_LOGOUT_KEY, '1');
  } catch (e) { console.warn('[commanderLogout] sessionStorage:', e?.message || e); }
}

/** Kill the HttpOnly PIN cookie. Best effort — the local clear still runs. */
export async function clearAdminPinSession() {
  try {
    await fetch('/api/commander/admin/pin-logout', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    });
  } catch { /* offline or blocked — nothing else depends on this resolving */ }
}

/**
 * Sign out and go to the login page.
 * @param {object} supabase - the Supabase client to sign out of.
 */
export async function commanderSignOut(supabase) {
  await clearAdminPinSession();

  try {
    const { error } = (await supabase?.auth?.signOut()) || {};
    if (error) console.warn('[commanderLogout] signOut reported:', error?.message || error);
  } catch (e) {
    console.warn('[commanderLogout] signOut threw:', e?.message || e);
  }

  clearCommanderSessionStorage();
  window.location.href = '/commander/login';
}
