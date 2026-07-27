/**
 * useClubBranding — Commander-local override (2026-07-26 audit follow-up).
 *
 * Previously re-exported the shared package. The only consumer
 * (pages/commander/displays/promotions.js) already imports this local path,
 * so no call sites change.
 *
 * THE BUG THIS FIXES
 * ------------------
 * `refresh()` read `staff.venue_name`, but `staff` was declared inside a
 * DIFFERENT useEffect and was never in scope here. So on every cache-cold
 * fetch the hook threw a ReferenceError immediately after setLogoUrl(...),
 * which the surrounding try/catch swallowed. Two consequences:
 *   1. the localStorage cache write below it never ran, so every mount
 *      re-fetched /api/commander/settings instead of using the 5 minute TTL;
 *   2. the venue name coming back from settings was never applied.
 *
 * The staff blob is now parsed inside refresh(), and the cache write is no
 * longer downstream of a throwing expression.
 */
import { useState, useEffect, useCallback } from 'react';

const CACHE_KEY = 'commander_branding';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Safely read the cached staff session without throwing. */
function readStaff() {
  try {
    return JSON.parse(localStorage.getItem('commander_staff') || '{}');
  } catch {
    return {};
  }
}

export default function useClubBranding() {
  const [logoUrl, setLogoUrl] = useState(null);
  const [clubName, setClubName] = useState('Poker Room');
  const [isLoading, setIsLoading] = useState(true);

  // Read cached data instantly
  useEffect(() => {
    try {
      const staff = readStaff();
      setClubName(staff.venue_name || 'Poker Room');

      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      if (cached.logo_url !== undefined) {
        setLogoUrl(cached.logo_url || null);
      }
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  // Fetch fresh from API (with TTL cache)
  const refresh = useCallback(async () => {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const now = Date.now();

      // Skip if cached recently
      if (cached.fetched_at && (now - cached.fetched_at) < CACHE_TTL) {
        if (cached.logo_url !== undefined) {
          setLogoUrl(cached.logo_url || null);
          setIsLoading(false);
          return;
        }
      }

      const staffSession = localStorage.getItem('commander_staff') || '';
      if (!staffSession) { setIsLoading(false); return; }

      // 2026-07-26 audit fix: `staff` is now resolved in this scope. It used to
      // be read from an outer effect's local, which threw here.
      const staff = readStaff();

      const res = await fetch('/api/commander/settings', {
        headers: { 'x-staff-session': staffSession }
      });
      const json = await res.json();

      if (json.success && json.data) {
        const url = json.data.club_logo_url || null;
        setLogoUrl(url);
        setClubName(staff.venue_name || json.data.venue_name || 'Poker Room');

        // Cache it — previously unreachable because the line above threw.
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          logo_url: url,
          fetched_at: now
        }));
      }
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    setIsLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Expose a manual refresh for after logo upload
  const invalidateCache = useCallback(() => {
    localStorage.removeItem(CACHE_KEY);
    refresh();
  }, [refresh]);

  return { clubName, logoUrl, isLoading, invalidateCache };
}
