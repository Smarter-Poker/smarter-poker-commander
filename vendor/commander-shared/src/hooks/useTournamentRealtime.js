/**
 * useTournamentRealtime - Hardened Supabase Realtime hook for Tournament Director
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Subscribes to changes on commander_tournament_entries, commander_tournaments
 * and commander_tables for the given tournamentId. Calls onUpdate() whenever
 * data changes, providing instant updates across all connected TD tablets and
 * TV displays.
 *
 * Hardening Features:
 *   - Stale closure prevention, uses ref for callback (no channel churn)
 *   - Debounced updates, batches rapid-fire events (300ms window)
 *   - Auto-reconnect, exponential backoff capped at one attempt per minute,
 *     retried indefinitely (see the 2026-08-20 fix note below)
 *   - Visibility awareness, skips refetch when hidden, catches up on focus
 *   - Online recovery, refetches when network comes back
 *   - SSR-safe, all browser APIs guarded
 *   - Timer leak prevention, all pending timers cleaned on unmount
 *
 * REALTIME-FIRST POLLING (2026-08-20)
 * -----------------------------------
 * Every screen used to run its own `setInterval(fetch, 30000)` next to this
 * hook, so a room with 20 tablets re-read the whole tournament 40 times a
 * minute whether anything had changed or not. Pass `poll: true` and the hook
 * owns the fallback poll itself and makes it adaptive:
 *
 *   - Channel not SUBSCRIBED, or SUBSCRIBED but it has never delivered an
 *     event, or its last event is older than the trust window
 *       -> poll at fastMs (the screen's old fixed interval, unchanged).
 *   - Channel SUBSCRIBED AND it delivered an event inside the trust window
 *       -> the channel is proven end to end, back off to slowMs.
 *
 * The slow tier is therefore only ever reached by a channel that has proved,
 * in this browser, on this subscription, that postgres_changes are actually
 * arriving. Anything less certain polls exactly as often as it did before.
 *
 * Returns the connection state so a screen can show Live vs Reconnecting:
 *   { status, isLive, isReconnecting, lastEventAt, lastFetchAt, pollMs }
 *   status: 'connecting' | 'live' | 'reconnecting' | 'offline'
 *
 * Usage:
 *   const conn = useTournamentRealtime(tournamentId, fetchFloor, { poll: true });
 *
 * Falls back gracefully if Realtime fails: polling still works as backup.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import useAdaptivePoll from './useAdaptivePoll';

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 60000;
const DEBOUNCE_MS = 300;

// Fallback poll tiers. fastMs matches what the screens used to do on their own.
const POLL_FAST_MS = 30000;
const POLL_LIVE_MS = 300000;
// How long a delivered event keeps the channel "proven". A tournament that has
// gone quiet for this long stops earning the slow tier and drops back to the
// fast one, which is also the fallback for a channel that died silently.
const EVENT_TRUST_MS = 600000;
// Two refreshes closer together than this are the same refresh. Stops a
// realtime event and a due poll from double-fetching on tab focus.
const MIN_FETCH_GAP_MS = 900;

export default function useTournamentRealtime(tournamentId, onUpdate, options = {}) {
    const {
        poll = false,
        fastMs = POLL_FAST_MS,
        slowMs = POLL_LIVE_MS,
        trustMs = EVENT_TRUST_MS
    } = options;

    // ── Ref for callback, prevents stale closure and channel churn ──
    const onUpdateRef = useRef(onUpdate);
    onUpdateRef.current = onUpdate;

    const channelRef = useRef(null);
    const debounceTimerRef = useRef(null);
    const reconnectCountRef = useRef(0);
    const reconnectTimerRef = useRef(null);
    const pendingWhileHiddenRef = useRef(false);
    const connectRef = useRef(null);

    // Connection state. Kept in a ref for the poll tier decision (read on every
    // supervisor tick) and mirrored into state only when it actually changes,
    // so the Live indicator re-renders but nothing else churns.
    const statusRef = useRef('connecting');
    const [status, setStatus] = useState('connecting');
    const lastEventAtRef = useRef(0);
    // Seeded with mount time: every screen fetches once on mount outside this
    // hook, so counting mount as a refresh stops the supervisor firing a
    // duplicate poll the instant the page opens.
    const lastFetchAtRef = useRef(Date.now());

    const applyStatus = useCallback((next) => {
        if (statusRef.current === next) return;
        statusRef.current = next;
        setStatus(next);
    }, []);

    // Single funnel for every refresh (realtime, poll, focus, online) so the
    // poll can be scheduled against the last refresh of ANY kind and two
    // triggers landing together cannot double-fetch.
    const fetchNow = useCallback(() => {
        const now = Date.now();
        if (now - lastFetchAtRef.current < MIN_FETCH_GAP_MS) return;
        lastFetchAtRef.current = now;
        onUpdateRef.current?.();
    }, []);

    useEffect(() => {
        if (!tournamentId || typeof window === 'undefined') return;

        const client = supabase;
        if (!client) {
            console.warn('[Realtime] Supabase client not available - using polling only');
            applyStatus('offline');
            return;
        }

        // Set by the cleanup below. removeChannel() can fire a final CLOSED
        // status callback, and without this the teardown would schedule a
        // reconnect after the effect had already been cleaned up.
        let disposed = false;

        // ── Debounced update ─────────────────────────────────────
        const debouncedUpdate = () => {
            // An event arriving proves the channel is delivering end to end.
            // Recorded even when the tab is hidden: the channel is healthy
            // either way, and the catch-up on focus is handled separately.
            // Deliberately a ref and not state: on a busy field this fires
            // constantly and must not re-render the screen on its own.
            lastEventAtRef.current = Date.now();

            // If tab is hidden, queue for when it becomes visible
            if (typeof document !== 'undefined' && document.hidden) {
                pendingWhileHiddenRef.current = true;
                return;
            }

            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(() => {
                debounceTimerRef.current = null;
                fetchNow();
            }, DEBOUNCE_MS);
        };

        // ── Visibility awareness, catch up when tab becomes visible ──
        const handleVisibility = () => {
            if (document.hidden) return;
            // Revive a channel that died while the tab was in the background
            // instead of waiting out the backoff.
            if (statusRef.current === 'reconnecting') {
                reconnectCountRef.current = 0;
                if (reconnectTimerRef.current) {
                    clearTimeout(reconnectTimerRef.current);
                    reconnectTimerRef.current = null;
                }
                connectRef.current?.();
            }
            if (pendingWhileHiddenRef.current) {
                pendingWhileHiddenRef.current = false;
                setTimeout(() => fetchNow(), 100);
            }
        };

        // ── Online recovery, refetch when network returns ──
        const handleOnline = () => {
            if (statusRef.current === 'reconnecting') {
                reconnectCountRef.current = 0;
                if (reconnectTimerRef.current) {
                    clearTimeout(reconnectTimerRef.current);
                    reconnectTimerRef.current = null;
                }
                connectRef.current?.();
            }
            fetchNow();
        };

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('online', handleOnline);

        // ── Channel connection with reconnect ────────────────────
        const connectChannel = () => {
            // Clean up existing channel
            if (channelRef.current) {
                try { client.removeChannel(channelRef.current); } catch { /* ignore */ }
                channelRef.current = null;
            }

            // Use deterministic tournament ID for multiplexing
            const channelName = `td-sync-${tournamentId}`;

            const channel = client
                .channel(channelName)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'commander_tournament_entries',
                        filter: `tournament_id=eq.${tournamentId}`
                    },
                    () => debouncedUpdate()
                )
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'commander_tournaments',
                        filter: `id=eq.${tournamentId}`
                    },
                    () => debouncedUpdate()
                )
                .on(
                    'postgres_changes',
                    {
                        // When a table is released or assigned, all connected pages
                        // (tables map, floor view) need to rebuild immediately.
                        // Filter by tournament_id so we only react to tables for THIS tournament.
                        event: '*',
                        schema: 'public',
                        table: 'commander_tables',
                        filter: `tournament_id=eq.${tournamentId}`
                    },
                    () => debouncedUpdate()
                )
                .subscribe((subStatus) => {
                    if (disposed) return;

                    if (subStatus === 'SUBSCRIBED') {
                        reconnectCountRef.current = 0;
                        applyStatus('live');
                    } else if (subStatus === 'CHANNEL_ERROR' || subStatus === 'TIMED_OUT' || subStatus === 'CLOSED') {
                        // 2026-08-20 fix: this used to stop retrying after 5
                        // attempts (~45s) and never resume, because the counter
                        // only reset on a successful SUBSCRIBE. Any outage longer
                        // than that killed realtime for the screen until a manual
                        // reload, with nothing in the UI to say so. Same bug that
                        // was fixed in useCommanderSync on 2026-07-27, still live
                        // here. Retries now continue indefinitely with the backoff
                        // capped at one attempt per minute, and the state is
                        // surfaced so the screen can say Reconnecting.
                        applyStatus('reconnecting');
                        // A dead channel is also an unproven channel: drop the
                        // trust immediately so the poll returns to the fast tier
                        // on the very next supervisor tick.
                        lastEventAtRef.current = 0;
                        reconnectCountRef.current++;
                        const delay = Math.min(RECONNECT_DELAY * reconnectCountRef.current, MAX_RECONNECT_DELAY);
                        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
                        reconnectTimerRef.current = setTimeout(() => {
                            reconnectTimerRef.current = null;
                            if (disposed) return;
                            if (channelRef.current === channel) {
                                connectChannel();
                            }
                        }, delay);
                    }
                });

            channelRef.current = channel;
        };

        connectRef.current = connectChannel;
        connectChannel();

        // ── Cleanup ──────────────────────────────────────────────
        return () => {
            disposed = true;
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (channelRef.current) {
                try { client.removeChannel(channelRef.current); } catch { /* ignore */ }
                channelRef.current = null;
            }
            connectRef.current = null;
            statusRef.current = 'connecting';
            lastEventAtRef.current = 0;
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('online', handleOnline);
        };
    }, [tournamentId, applyStatus, fetchNow]); // callback itself is in a ref

    // ── Adaptive fallback poll ───────────────────────────────────
    // Proven means: subscribed right now AND an event actually arrived inside
    // the trust window. Anything else polls at the old fixed rate.
    const pollProven = () => (
        statusRef.current === 'live' &&
        lastEventAtRef.current > 0 &&
        (Date.now() - lastEventAtRef.current) < trustMs
    );

    useAdaptivePoll({
        enabled: poll && !!tournamentId,
        // Ticks often enough to react to a channel drop quickly, without
        // outrunning the fastest screen (the TV clock polls at 3s).
        checkMs: Math.max(500, Math.min(5000, Math.floor(fastMs / 4))),
        getIntervalMs: () => (pollProven() ? slowMs : fastMs),
        getLastFetchAt: () => lastFetchAtRef.current,
        onPoll: fetchNow
    });

    const isLive = status === 'live';
    // lastEventAt / lastFetchAt / pollMs are read from refs, so they are
    // accurate as of the last render rather than reactive. They exist for
    // diagnostics; the indicator renders off `status`, which IS state.
    return {
        status,
        isLive,
        isReconnecting: status === 'reconnecting' || status === 'connecting',
        lastEventAt: lastEventAtRef.current,
        lastFetchAt: lastFetchAtRef.current,
        pollMs: pollProven() ? slowMs : fastMs,
        refresh: fetchNow
    };
}
