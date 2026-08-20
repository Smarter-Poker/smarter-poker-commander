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

  // 401 = token expired or invalid → redirect to login
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      // Store the current page so login can redirect back
      try { sessionStorage.setItem('commander_return_url', window.location.pathname); } catch (e) { console.warn('[App] Handled exception:', e); }
      window.location.href = '/commander/login?expired=1';
    }
    // Still throw so the caller's catch block fires
    throw new Error('Session expired - redirecting to login');
  }

  // Session expiry warning: check PIN session TTL (non-blocking)
  if (typeof window !== 'undefined' && staffSession) {
    try {
      const parsed = JSON.parse(staffSession);
      if (parsed.session_ts) {
        const elapsed = Date.now() - parsed.session_ts;
        const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
        const WARN_MS = TTL_MS - (15 * 60 * 1000); // warn at 11h45m
        // Track WHICH session_ts we already warned about - resets on new login
        if (elapsed > WARN_MS && window.__commander_ttl_warned_ts !== parsed.session_ts) {
          window.__commander_ttl_warned_ts = parsed.session_ts;
          const minsLeft = Math.max(0, Math.round((TTL_MS - elapsed) / 60000));
          console.warn(`[Commander] PIN session expires in ~${minsLeft} minutes`);
          // Dispatch event that CommanderLayout can listen to for a banner
          window.dispatchEvent(new CustomEvent('commander:session-expiring', { detail: { minutesLeft: minsLeft } }));
        }
      }
    } catch { /* not a PIN session or malformed - ignore */ }
  }

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
