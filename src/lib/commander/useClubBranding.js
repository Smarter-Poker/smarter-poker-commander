/**
 * useClubBranding — Central hook for club logo + name
 * 
 * Reads from commander_venue_settings (via /api/commander/settings)
 * with localStorage cache so displays load instantly.
 * 
 * Usage:
 *   const { clubName, logoUrl, isLoading } = useClubBranding();
 * 
 * The logo is uploaded once on the Settings page and consumed everywhere:
 *   - All TV display pages (promotions, waitlist, leaderboard, etc.)
 *   - CommanderLayout hamburger menu
 *   - Dealer Ticker
 */
import { useState, useEffect, useCallback } from 'react';

const CACHE_KEY = 'commander_branding';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default function useClubBranding() {
    const [logoUrl, setLogoUrl] = useState(null);
    const [clubName, setClubName] = useState('Poker Room');
    const [isLoading, setIsLoading] = useState(true);

    // Read cached data instantly
    useEffect(() => {
        try {
            const staff = JSON.parse(localStorage.getItem('commander_staff') || '{}');
            setClubName(staff.venue_name || 'Poker Room');

            const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            if (cached.logo_url !== undefined) {
                setLogoUrl(cached.logo_url || null);
            }
        } catch (e) { console.warn('[App] Handled exception:', e); }
    }, []);

    // Fetch fresh from API (with TTL cache)
    const refresh = useCallback(async () => {
        try {
            const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            const now = Date.now();

            // Skip if cached recently (unless forced)
            if (cached.fetched_at && (now - cached.fetched_at) < CACHE_TTL) {
                if (cached.logo_url !== undefined) {
                    setLogoUrl(cached.logo_url || null);
                    setIsLoading(false);
                    return;
                }
            }

            const staffSession = localStorage.getItem('commander_staff') || '';
            if (!staffSession) { setIsLoading(false); return; }

            const res = await fetch('/api/commander/settings', {
                headers: { 'x-staff-session': staffSession }
            });
            const json = await res.json();

            if (json.success && json.data) {
                const url = json.data.club_logo_url || null;
                setLogoUrl(url);
                setClubName(staff.venue_name || json.data.venue_name || 'Poker Room');

                // Cache it
                localStorage.setItem(CACHE_KEY, JSON.stringify({
                    logo_url: url,
                    fetched_at: now
                }));
            }
        } catch (e) { console.warn('[App] Handled exception:', e); }
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
