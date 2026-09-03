/**
 * Commander Fetch Wrapper
 * Centralized fetch with automatic auth headers & 401 self-heal.
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
 * - On 401, silently re-mints the signed staff session from the live
 *   Smarter.Poker session and retries ONCE before telling anyone
 * - Merges caller-provided headers (caller headers take precedence)
 * - Returns the raw Response object (caller handles .json())
 */
import { getToken, getStaffSession } from './clientAuth';
import { refreshStaffSession } from './staffSession';

function buildHeaders(opts) {
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
  return mergedHeaders;
}

function announceUnauthorized(url) {
  if (typeof window === 'undefined') return;
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

// A request body that is a stream can only be sent once; everything else
// (string / FormData / Blob / URLSearchParams / ArrayBuffer) is safe to resend.
function isRetryable(opts) {
  const body = opts.body;
  if (body == null) return true;
  if (typeof body === 'string') return true;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return false;
  return true;
}

/**
 * Fetch wrapper that auto-injects Commander auth headers.
 * @param {string} url - API URL
 * @param {RequestInit} [opts] - Standard fetch options
 * @returns {Promise<Response>}
 */
export async function commanderFetch(url, opts = {}) {
  let response = await fetch(url, { ...opts, headers: buildHeaders(opts) });

  // 401 = token expired, invalid, or the route requires a session this client
  // does not have.
  //
  // 2026-08-20: this used to swallow the 401 and return a FABRICATED HTTP 200
  // carrying a hardcoded club. The real 401 is now passed through so callers
  // can handle it, and CommanderLayout surfaces a banner.
  //
  // 2026-09-03 SELF-HEAL: the signed `commander_staff` session has a 7-day
  // TTL, is invalidated whenever the signing secret rotates, and was being
  // mutated client-side by the club switcher (which breaks its HMAC). In all
  // of those cases the user's Smarter.Poker session was still perfectly
  // valid - only the derived Commander token had gone stale - yet the app
  // painted "Your Session Is Not Valid" and sent them back to a login page.
  // A stale derived token is not a reason to ask a signed-in user for their
  // password: re-mint it from the live session and retry the request once.
  // Only if THAT fails do we announce the 401.
  if (response.status === 401 && typeof window !== 'undefined' && !opts.__commanderRetried) {
    let healed = false;
    try { healed = await refreshStaffSession(); } catch { healed = false; }
    if (healed && isRetryable(opts)) {
      const retryOpts = { ...opts, __commanderRetried: true };
      response = await fetch(url, { ...retryOpts, headers: buildHeaders(retryOpts) });
    }
  }

  if (response.status === 401) {
    announceUnauthorized(url);
    return response;
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
