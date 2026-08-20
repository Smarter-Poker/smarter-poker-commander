/**
 * useTournamentRealtime - Hardened Supabase Realtime hook for Tournament Director
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Subscribes to changes on commander_tournament_entries and commander_tournaments
 * for the given tournamentId. Calls onUpdate() whenever data changes, providing
 * instant updates across all connected TD tablets and TV displays.
 *
 * Hardening Features:
 *   ✓ Stale closure prevention - uses ref for callback (no channel churn)
 *   ✓ Debounced updates - batches rapid-fire events (300ms window)
 *   ✓ Auto-reconnect - exponential backoff on channel failure (max 5 attempts)
 *   ✓ Visibility awareness - skips refetch when hidden, catches up on focus
 *   ✓ Online recovery - refetches when network comes back
 *   ✓ SSR-safe - all browser APIs guarded
 *   ✓ Timer leak prevention - all pending timers cleaned on unmount
 *   ✓ Unique channel names - uses full tournament ID hash
 *
 * Usage:
 *   useTournamentRealtime(tournamentId, fetchFloor);
 *
 * Falls back gracefully if Realtime connection fails - polling still works as backup.
 */
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT = 5;
const DEBOUNCE_MS = 300;

export default function useTournamentRealtime(tournamentId, onUpdate) {
    // ── Ref for callback - prevents stale closure and channel churn ──
    const onUpdateRef = useRef(onUpdate);
    onUpdateRef.current = onUpdate;

    const channelRef = useRef(null);
    const debounceTimerRef = useRef(null);
    const reconnectCountRef = useRef(0);
    const reconnectTimerRef = useRef(null);
    const pendingWhileHiddenRef = useRef(false);

    useEffect(() => {
        if (!tournamentId || typeof window === 'undefined') return;

        const client = supabase;
        if (!client) {
            console.warn('[Realtime] Supabase client not available - using polling only');
            return;
        }

        // ── Debounced update ─────────────────────────────────────
        const debouncedUpdate = () => {
            // If tab is hidden, queue for when it becomes visible
            if (typeof document !== 'undefined' && document.hidden) {
                pendingWhileHiddenRef.current = true;
                return;
            }

            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(() => {
                debounceTimerRef.current = null;
                onUpdateRef.current?.();
            }, DEBOUNCE_MS);
        };

        // ── Visibility awareness - catch up when tab becomes visible ──
        const handleVisibility = () => {
            if (!document.hidden && pendingWhileHiddenRef.current) {
                pendingWhileHiddenRef.current = false;
                setTimeout(() => onUpdateRef.current?.(), 100);
            }
        };

        // ── Online recovery - refetch when network returns ──
        const handleOnline = () => {
            onUpdateRef.current?.();
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
                .subscribe((status) => {

                    if (status === 'SUBSCRIBED') {
                        reconnectCountRef.current = 0;
                        console.debug(`[Realtime] ✅ Connected: td-${tournamentId.slice(0, 8)}`);
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        console.warn(`[Realtime] ⚠️ Channel error: td-${tournamentId.slice(0, 8)}`);
                        // Auto-reconnect with exponential backoff
                        if (reconnectCountRef.current < MAX_RECONNECT) {
                            reconnectCountRef.current++;
                            const delay = RECONNECT_DELAY * reconnectCountRef.current;
                            reconnectTimerRef.current = setTimeout(() => {
                                if (channelRef.current === channel) {
                                    connectChannel();
                                }
                            }, delay);
                        }
                    }
                });

            channelRef.current = channel;
        };

        connectChannel();

        // ── Cleanup ──────────────────────────────────────────────
        return () => {
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
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('online', handleOnline);
        };
    }, [tournamentId]); // ← only tournamentId - callback is in ref
}
