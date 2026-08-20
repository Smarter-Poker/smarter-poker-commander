/**
 * Commander Fetch Wrapper
 * Centralized fetch with automatic auth headers & 401 redirect.
 *
 * Usage:
 *   import { commanderFetch, commanderFetchJSON } from '@/lib/commander/commanderFetch';
 *
 *   // Raw response (caller handles .json()):
 *   const res = await commanderFetch('/api/commander/tables?venue_id=xxx');
 *
 *   // Auto-parsed JSON with !ok error throwing:
 *   const data = await commanderFetchJSON('/api/commander/cashier', { method: 'POST', body: JSON.stringify(payload) });
 *
 * Features:
 * - Automatically injects Authorization + x-staff-session headers
 * - Auto-adds Content-Type: application/json on POST/PUT/PATCH (when body is present)
 * - Skips Authorization header if token is empty (PIN-based terminal staff)
 * - On 401 response, redirects to /commander/login with session-expired message
 * - Merges caller-provided headers (caller headers take precedence)
 * - Returns the raw Response object (caller handles .json())
 */
import { getToken, getStaffSession } from './clientAuth';

/**
 * Fetch wrapper that auto-injects Commander auth headers.
 * @param {string} url - API URL
 * @param {RequestInit} [opts] - Standard fetch options
 * @returns {Promise<Response>}
 */
export async function commanderFetch(url, opts = {}) {
  const token = getToken();
  const staffSession = getStaffSession();

  const mergedHeaders = {
    'x-staff-session': staffSession,
    ...opts.headers,
  };

  // Only add Authorization if we actually have a token (PIN staff won't)
  if (token) {
    mergedHeaders['Authorization'] = mergedHeaders['Authorization'] || `Bearer ${token}`;
  }

  // Auto-add Content-Type for mutation methods with body
  const method = (opts.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH'].includes(method) && opts.body && !mergedHeaders['Content-Type']) {
    mergedHeaders['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...opts, headers: mergedHeaders });

  // 401 = token expired, invalid, or the route requires a session this client
  // does not have.
  //
  // 2026-08-20 FIX: this used to swallow the 401 and return a FABRICATED
  // HTTP 200 carrying a hardcoded club ("Club JAQK", venue_id 'v1'). Every
  // caller in the app therefore believed an unauthenticated request had
  // succeeded and rendered invented data. That was survivable while almost
  // nothing was guarded; it became dangerous the moment ~48 routes started
  // returning 401 correctly, because a signed-out or expired session now
  // silently paints a plausible-looking screen instead of asking anyone to
  // log in. Fabricated data on a poker floor is worse than an error.
  //
  // The real 401 is now passed through untouched so callers can handle it.
  // We deliberately do NOT hard-redirect here: a previous change removed that
  // because a spurious 401 could trap the user in a login redirect loop.
  // Instead we announce it once and let CommanderLayout surface a banner.
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('commander_return_url', window.location.pathname);
      } catch (e) { console.warn('[App] Handled exception:', e); }
      // Throttle: one announcement per 10s, no matter how many polls 401.
      const now = Date.now();
      if (!window.__commander_401_at || now - window.__commander_401_at > 10000) {
        window.__commander_401_at = now;
        try {
          window.dispatchEvent(new CustomEvent('commander:unauthorized', {
            detail: { url: typeof url === 'string' ? url : String(url) }
          }));
        } catch (e) { console.warn('[App] Handled exception:', e); }
      }
    }
    return response;
  }

  // Session expiry warning (non-blocking).
  // 2026-08-20 FIX: this check previously applied the 12-hour PIN TTL to
  // EVERY session type. Owner sessions are valid for 7 DAYS server-side
  // (OWNER_SESSION_TTL_MS in lib/commander/auth), so ~12h after login the
  // client would dispatch minutesLeft:0, CommanderLayout would hard-redirect
  /*
  if (typeof window !== 'undefined' && staffSession) {
    try {
      const parsed = JSON.parse(staffSession);
      if (parsed.session_ts) {
        const isPinSession = !!parsed.id;
        const TTL_MS = isPinSession
          ? 12 * 60 * 60 * 1000        // PIN terminals: 12h (matches server)
          : 7 * 24 * 60 * 60 * 1000;   // Owner logins: 7d (matches server)
        const elapsed = Date.now() - parsed.session_ts;
        const WARN_MS = TTL_MS - (15 * 60 * 1000); // warn 15 min before expiry
        // Track WHICH session_ts we already warned about - resets on new login
        if (elapsed > WARN_MS && window.__commander_ttl_warned_ts !== parsed.session_ts) {
          window.__commander_ttl_warned_ts = parsed.session_ts;
          const minsLeft = Math.max(0, Math.round((TTL_MS - elapsed) / 60000));
          console.warn(`[Commander] ${isPinSession ? 'PIN' : 'Owner'} session expires in ~${minsLeft} minutes`);
          // Dispatch event that CommanderLayout can listen to for a banner
          window.dispatchEvent(new CustomEvent('commander:session-expiring', { detail: { minutesLeft: minsLeft } }));
        }
      }
    } catch {  }
  }
  */

  return response;
}

/**
 * Convenience: commanderFetch + auto-parse JSON + throw on !ok.
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<any>} parsed JSON
 */
export async function commanderFetchJSON(url, opts = {}) {
  const res = await commanderFetch(url, opts);
  if (!res.ok) {
    let errorMsg = `Request failed (${res.status})`;
    try { const body = await res.json(); errorMsg = body?.error?.message || body?.error || errorMsg; } catch (e) { console.warn('[App] Handled exception:', e); }
    throw new Error(errorMsg);
  }
  return res.json();
}
