/**
 * useAdaptivePoll - Realtime-First Polling With A Safety Net
 * ═══════════════════════════════════════════════════════════
 *
 * Commander screens have always done BOTH: a Supabase Realtime subscription
 * AND a fixed setInterval poll. On a big field with 20 tablets, 6 dealer
 * screens and 3 TVs in the room that fixed poll is the dominant read load,
 * and almost every one of those reads returns data the realtime channel had
 * already delivered a second earlier.
 *
 * This hook replaces the fixed setInterval with a supervisor that asks the
 * caller, continuously, how long the gap between refreshes is allowed to be
 * right now. The caller answers "fast" while the realtime channel is
 * unproven or broken, and "slow" only while the channel is confirmed
 * SUBSCRIBED and has actually delivered an event recently.
 *
 * Design rules (all of them are safety rules, not optimisations):
 *
 *   1. The poll is scheduled against the LAST REFRESH of any kind, not
 *      against the last poll. A realtime-driven refetch pushes the next
 *      safety poll out, so the two mechanisms never stack.
 *   2. A hidden document is never polled. Nothing on a black screen needs
 *      fresh data, and a rack of idle tablets used to poll all night.
 *   3. Becoming visible refetches immediately if a refresh was due or was
 *      skipped while hidden, so an operator picking a tablet back up sees
 *      current data at once.
 *   4. Uncertainty always resolves toward polling. getIntervalMs returning
 *      anything that is not a positive finite number falls back to 30s.
 *
 * The supervisor ticks on a cheap timer (a Date comparison) rather than
 * scheduling one long timeout, so a channel that drops during a five minute
 * wait is picked up within one tick instead of five minutes.
 *
 * @param {object}   options
 * @param {boolean}  [options.enabled=true]     Turn the whole poller off.
 * @param {function} options.getIntervalMs      () => ms allowed since the last refresh.
 * @param {function} options.getLastFetchAt     () => epoch ms of the last refresh of any kind.
 * @param {function} options.onPoll             Called when a refresh is due.
 * @param {number}   [options.checkMs=5000]     Supervisor tick.
 */
import { useEffect, useRef } from 'react';

const FALLBACK_INTERVAL_MS = 30000;

export default function useAdaptivePoll(options = {}) {
    const { enabled = true, checkMs = 5000 } = options;

    // Everything else is read through a ref so a re-render never restarts the
    // supervisor (which would reset the timing on every keystroke upstream).
    const optsRef = useRef(options);
    optsRef.current = options;

    const missedWhileHiddenRef = useRef(false);

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        const intervalNow = () => {
            let raw;
            try { raw = Number(optsRef.current.getIntervalMs?.()); } catch { raw = NaN; }
            return Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_INTERVAL_MS;
        };

        const lastFetchAt = () => {
            let raw;
            try { raw = Number(optsRef.current.getLastFetchAt?.()); } catch { raw = 0; }
            return Number.isFinite(raw) ? raw : 0;
        };

        const isDue = () => (Date.now() - lastFetchAt()) >= intervalNow();

        const runPoll = () => {
            try { optsRef.current.onPoll?.(); } catch (err) {
                console.warn('[AdaptivePoll] Poll failed:', err?.message || err);
            }
        };

        const check = () => {
            if (document.hidden) {
                // Remember that the screen went stale while nobody was looking,
                // so the catch-up on focus is not gated on the exact timing.
                if (isDue()) missedWhileHiddenRef.current = true;
                return;
            }
            if (!isDue()) return;
            runPoll();
        };

        const handleVisibility = () => {
            if (document.hidden) return;
            if (missedWhileHiddenRef.current || isDue()) {
                missedWhileHiddenRef.current = false;
                runPoll();
            }
        };

        const timer = setInterval(check, Math.max(250, Number(checkMs) || 5000));
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [enabled, checkMs]);
}
