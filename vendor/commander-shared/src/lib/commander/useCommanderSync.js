/**
 * useCommanderSync — Entity-Aware Two-Layer Real-Time Sync for Commander
 * ═══════════════════════════════════════════════════════════════════
 *
 * Layer 1: BroadcastChannel (instant, same browser, zero cost)
 *   When any tab writes data, it calls broadcastChange('tables').
 *   All OTHER tabs subscribed to 'tables' hear it and refetch instantly.
 *   Self-tab broadcasts are suppressed via tab ID.
 *
 * Layer 2: Supabase Realtime (cross-device, ~1s)
 *   Uses a SINGLETON channel manager — one Supabase channel per venue
 *   shared across all hook instances in the same tab. Automatically
 *   expands the table subscription set when new subscribers need
 *   additional tables.
 *
 * Hardening Features:
 *   ✓ Entity-aware filtering — only refetch when YOUR entities change
 *   ✓ Singleton channel — one channel per venue per tab (no duplicates)
 *   ✓ Selective subscriptions — pages only listen to tables they need
 *   ✓ Tab visibility awareness — skips refetch when hidden, catches up on focus
 *   ✓ Online/offline resilience — refetches when network comes back
 *   ✓ Self-tab suppression — won't refetch from your own broadcasts
 *   ✓ Per-instance throttle — prevents refetch storms (max 1 per 500ms)
 *   ✓ Supabase reconnect — retries on channel failure (exponential backoff)
 *   ✓ Stale closure prevention — uses refs for callbacks
 *   ✓ SSR-safe — all browser APIs guarded
 *   ✓ setTimeout leak prevention — pending timers cleaned on unmount
 *   ✓ Full entity coverage — 12 Supabase tables with entity mapping
 *
 * Usage:
 *   // Subscribe to ALL entities (backward compatible):
 *   useCommanderSync(venueId, fetchData);
 *
 *   // Subscribe to SPECIFIC entities only (selective subscription):
 *   useCommanderSync(venueId, fetchData, { entities: ['tables', 'games'] });
 *
 *   // Writer side — broadcast after mutation:
 *   import { broadcastChange } from '@/lib/commander/useCommanderSync';
 *   await fetch('/api/...');
 *   broadcastChange('tables');
 */
import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { broadcastSync, listenBroadcast } from '../broadcastSync';

// ─── Constants ─────────────────────────────────────────────────
const CHANNEL_NAME = 'commander-sync';
const THROTTLE_MS = 500;       // Max 1 refetch per 500ms per hook instance
const RECONNECT_DELAY = 3000;      // Base retry delay on Supabase channel failure
const MAX_RECONNECT_DELAY = 60000; // Backoff ceiling — retries continue indefinitely

// Unique ID for this tab — used to suppress self-broadcasts
const TAB_ID = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ─── Supabase table → entity mapping ───────────────────────────
const TABLE_TO_ENTITY = {
    commander_tables: 'tables',
    commander_games: 'games',
    commander_waitlist: 'waitlist',
    commander_floor_calls: 'floor_calls',
    // commander_seats excluded — lacks venue_id column (changes propagate via commander_games/commander_tables)
    // 2026-07-28 fix: this key was `commander_settings`, a table that has never
    // existed in the database (to_regclass('public.commander_settings') is NULL).
    // The Realtime binding therefore targeted a nonexistent relation: settings
    // changes never propagated, and because channelManager opens ONE shared
    // channel per venue over the union of all subscribers' tables, the bad
    // binding put every other subscription on that channel at risk too.
    // The real table is commander_venue_settings (not commander_admin_settings).
    commander_venue_settings: 'settings',
    commander_staff: 'staff',
    commander_staff_shifts: 'staff', // Shift schedule changes affect staff views
    commander_time_clock: 'staff',   // Time clock changes affect staff views
    commander_members: 'members',
    commander_dealers: 'dealers',
    commander_dealer_rotations: 'dealers',     // Rotation changes affect dealer views
    commander_table_sessions: 'tables',        // Session changes affect table views
    commander_tournaments: 'tournaments',
    // commander_tournament_entries excluded — lacks venue_id column (changes propagate via commander_tournaments)
    commander_incidents: 'incidents',
    commander_notifications: 'notifications',
    commander_club_announcements: 'announcements',
    commander_streams: 'streaming',            // Realtime not yet enabled for this table
};

// ─── Entity → Supabase tables reverse map (Optimization 2) ────
// NOTE: commander_seats and commander_tournament_entries are excluded because
// they lack a venue_id column, so subscribing to them would cause cross-venue
// noise (every venue tab sees every change across the entire platform).
// Parent tables (commander_tables, commander_tournaments) pick up changes
// through API-side cascading updates (game/waitlist mutations always update
// the parent table's row or related entities that have venue_id).
const ENTITY_TO_TABLES = {
    tables: ['commander_tables', 'commander_table_sessions'],
    games: ['commander_games'],
    waitlist: ['commander_waitlist'],
    floor_calls: ['commander_floor_calls'],
    settings: ['commander_venue_settings'],
    staff: ['commander_staff', 'commander_staff_shifts', 'commander_time_clock'],
    members: ['commander_members'],
    dealers: ['commander_dealers', 'commander_dealer_rotations'],
    tournaments: ['commander_tournaments'],
    incidents: ['commander_incidents'],
    notifications: ['commander_notifications'],
    announcements: ['commander_club_announcements'],
    streaming: ['commander_streams'],              // Realtime not yet enabled
    // 'marketplace' — no dedicated Supabase table, BroadcastChannel only
};

// All Supabase tables (used when no entity filter is specified)
const ALL_SUPABASE_TABLES = Object.keys(TABLE_TO_ENTITY || {});

// ─── Singleton Channel Manager (Optimization 1) ───────────────
// Shares ONE Supabase Realtime channel per venue across all hook
// instances in the same browser tab. Creates on first subscriber,
// destroys when last subscriber leaves.
const channelManager = {
    // venueId → { channel, subscribers: Set<callback>, tables: Set<string>, reconnects: number }
    venues: {},

    /**
     * Register a subscriber for a venue.
     * @param {string|number} venueId
     * @param {string[]} tables - Supabase tables this subscriber needs
     * @param {function} callback - (entity) => void
     */
    subscribe(venueId, tables, callback) {
        const key = String(venueId);
        const client = supabase;
        if (!client) return;

        if (!this.venues[key]) {
            // First subscriber for this venue — create the entry
            this.venues[key] = {
                channel: null,
                subscribers: new Set(),
                tables: new Set(tables),
                reconnects: 0,
                reconnectTimer: null,
                status: null,
            };
            this.venues[key].subscribers.add(callback);
            this._connect(key);
        } else {
            const entry = this.venues[key];
            entry.subscribers.add(callback);

            // Check if new subscriber needs tables we don't have yet
            const hadAllTables = tables.every(t => entry.tables.has(t));
            if (!hadAllTables) {
                tables.forEach(t => entry.tables.add(t));
                // Reconnect with expanded table set
                this._connect(key);
            }
        }
    },

    /**
     * Unregister a subscriber. Tears down channel when last one leaves.
     * @param {string|number} venueId
     * @param {function} callback
     */
    unsubscribe(venueId, callback) {
        const key = String(venueId);
        const entry = this.venues[key];
        if (!entry) return;

        entry.subscribers.delete(callback);

        if (entry.subscribers.size === 0) {
            // Last subscriber gone — tear down the channel and clear reconnect timer
            if (entry.reconnectTimer) {
                clearTimeout(entry.reconnectTimer);
                entry.reconnectTimer = null;
            }
            this._disconnect(key);
            delete this.venues[key];
        }
    },

    /**
     * 2026-07-27 audit fix: force an immediate reconnect if this venue's
     * channel is not currently subscribed. Called when the tab regains focus
     * or the network returns, so an operator coming back to a floor tablet
     * gets live data at once instead of waiting out the backoff timer.
     * @param {string|number} venueId
     */
    ensureHealthy(venueId) {
        const key = String(venueId);
        const entry = this.venues[key];
        if (!entry || entry.subscribers.size === 0) return;
        if (entry.status === 'SUBSCRIBED') return;
        if (entry.reconnectTimer) {
            clearTimeout(entry.reconnectTimer);
            entry.reconnectTimer = null;
        }
        entry.reconnects = 0; // fresh start — this is a user-driven revival
        this._connect(key);
    },

    /** @private Connect/reconnect the Supabase channel for a venue */
    _connect(venueKey) {
        const client = supabase;
        if (!client) return;

        const entry = this.venues[venueKey];
        if (!entry) return;

        // Clean up existing channel
        if (entry.channel) {
            try { client.removeChannel(entry.channel); } catch { /* ignore */ }
            entry.channel = null;
        }

        const channel = client.channel(`commander-sync:${venueKey}:${Date.now()}`);

        entry.tables.forEach(table => {
            channel.on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table,
                    filter: `venue_id=eq.${venueKey}`,
                },
                () => {
                    // Map Supabase table name → entity name
                    const entity = TABLE_TO_ENTITY[table] || table;
                    // Notify ALL subscribers (each does its own entity filtering)
                    entry.subscribers.forEach(cb => {
                        try { cb(entity); } catch { /* subscriber error — don't break others */ }
                    });
                }
            );
        });

        channel.subscribe((status) => {
            entry.status = status;
            if (status === 'SUBSCRIBED') {
                entry.reconnects = 0;
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                // 2026-07-27 audit fix: this previously stopped retrying after 5
                // attempts (~45s) and never resumed, because `reconnects` only
                // reset on a successful SUBSCRIBE. Any outage longer than that
                // silently killed realtime for the whole venue in that tab —
                // every Commander screen stopped updating until a manual reload,
                // and FloorCallAlert (which has no polling fallback) stopped
                // announcing floor calls entirely.
                //
                // Retries now continue indefinitely with exponential backoff
                // capped at MAX_RECONNECT_DELAY, so a long outage costs at most
                // one attempt per minute and recovers on its own.
                entry.reconnects++;
                const delay = Math.min(RECONNECT_DELAY * entry.reconnects, MAX_RECONNECT_DELAY);
                // Clear any previous reconnect timer to avoid stacking
                if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
                entry.reconnectTimer = setTimeout(() => {
                    entry.reconnectTimer = null;
                    // Only reconnect if this entry still exists and channel hasn't changed
                    if (this.venues[venueKey] && this.venues[venueKey].channel === channel) {
                        this._connect(venueKey);
                    }
                }, delay);
            }
        });

        entry.channel = channel;
    },

    /** @private Disconnect a venue's channel */
    _disconnect(venueKey) {
        const client = supabase;
        if (!client) return;

        const entry = this.venues[venueKey];
        if (!entry?.channel) return;

        try { client.removeChannel(entry.channel); } catch { /* ignore */ }
        entry.channel = null;
    },
};

/**
 * Compute the minimal set of Supabase tables needed for a set of entities.
 * Returns ALL tables if no entities are specified (backward compatible).
 * @param {string[]|null} entities
 * @returns {string[]}
 */
function computeTablesForEntities(entities) {
    if (!entities || entities.length === 0) return ALL_SUPABASE_TABLES;
    const tableSet = new Set();
    entities.forEach(entity => {
        const tables = ENTITY_TO_TABLES[entity];
        if (tables) tables.forEach(t => tableSet.add(t));
    });
    // Fallback: if no valid entities matched, subscribe to all
    return tableSet.size > 0 ? Array.from(tableSet) : ALL_SUPABASE_TABLES;
}

/**
 * Broadcast a data change to all other open Commander tabs.
 * Call this AFTER a successful write (POST/PUT/PATCH/DELETE).
 *
 * @param {string} entity - What changed: 'tables' | 'games' | 'floor_calls' | 'waitlist' | 'settings' | 'dealers' | 'staff' | 'members' | 'tournaments' | 'incidents'
 */
export function broadcastChange(entity) {
    broadcastSync(CHANNEL_NAME, {
        type: 'data-changed',
        entity,
        tabId: TAB_ID,
        ts: Date.now(),
    });
}

// ─── useCommanderSync ──────────────────────────────────────────
/**
 * Hook: listen for cross-tab + cross-device changes and auto-refetch.
 *
 * @param {string|number} venueId - Venue to subscribe to
 * @param {function} onRefetch - Called when data changes are detected
 * @param {object} [opts] - Options
 * @param {string[]} [opts.entities] - Entity types to listen for (selective subscription)
 * @param {string[]} [opts.tables] - Override Supabase tables to subscribe to (advanced)
 */
export function useCommanderSync(venueId, onRefetch, opts = {}) {
    const refetchRef = useRef(onRefetch);
    refetchRef.current = onRefetch;

    const lastRefetchRef = useRef(0);
    const pendingWhileHiddenRef = useRef(false);
    const pendingTimerRef = useRef(null);

    // Entity filter — if provided, only refetch when matching entity changes
    const entitiesRef = useRef(opts.entities || null);
    entitiesRef.current = opts.entities || null;

    // ── Throttled refetch ───────────────────────────────────────
    const throttledRefetchRef = useRef(null);
    throttledRefetchRef.current = (entity) => {
        // Entity filtering — skip if this hook doesn't care about this entity
        if (entitiesRef.current && entity && !entitiesRef.current.includes(entity)) {
            return;
        }

        const now = Date.now();
        const elapsed = now - lastRefetchRef.current;

        // If tab is hidden, queue the refetch for when it becomes visible
        if (typeof document !== 'undefined' && document.hidden) {
            pendingWhileHiddenRef.current = true;
            return;
        }

        if (elapsed < THROTTLE_MS) {
            // Clear any existing pending timer to avoid double-fire
            if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
            // Schedule for after throttle window
            pendingTimerRef.current = setTimeout(() => {
                pendingTimerRef.current = null;
                lastRefetchRef.current = Date.now();
                refetchRef.current?.(entity);
            }, THROTTLE_MS - elapsed);
        } else {
            lastRefetchRef.current = now;
            refetchRef.current?.(entity);
        }
    };

    // Stable callback wrapper for the channel manager (never changes identity)
    const stableCallbackRef = useRef(null);
    if (!stableCallbackRef.current) {
        stableCallbackRef.current = (entity) => throttledRefetchRef.current?.(entity);
    }

    // ── Layer 1: BroadcastChannel (same browser, instant) ───────
    useEffect(() => {
        const cleanup = listenBroadcast(CHANNEL_NAME, (msg) => {
            if (msg?.type !== 'data-changed') return;

            // Suppress self-tab broadcasts — this tab already has fresh data
            if (msg.tabId === TAB_ID) return;

            // Guard against stale messages (older than 10s)
            if (msg.ts && Date.now() - msg.ts > 10000) return;

            throttledRefetchRef.current?.(msg.entity);
        });

        return () => {
            cleanup();
            if (pendingTimerRef.current) {
                clearTimeout(pendingTimerRef.current);
                pendingTimerRef.current = null;
            }
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Visibility + Online awareness ───────────────────────────
    useEffect(() => {
        if (typeof document === 'undefined' || typeof window === 'undefined') return;

        const handleVisibility = () => {
            if (document.hidden) return;
            // 2026-07-27 audit fix: revive a dead realtime channel on focus.
            // Previously a tab that lost its channel refetched at most once and
            // then stayed silent forever.
            if (venueId) channelManager.ensureHealthy(venueId);
            if (pendingWhileHiddenRef.current) {
                pendingWhileHiddenRef.current = false;
                // Small delay to let rendering settle after tab focus
                setTimeout(() => {
                    lastRefetchRef.current = Date.now();
                    refetchRef.current?.();
                }, 100);
            }
        };

        const handleOnline = () => {
            // Network came back — revive the channel, then refetch to catch up
            if (venueId) channelManager.ensureHealthy(venueId);
            lastRefetchRef.current = Date.now();
            refetchRef.current?.();
        };

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('online', handleOnline);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('online', handleOnline);
        };
    }, [venueId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Layer 2: Supabase Realtime via Singleton Channel Manager ─
    useEffect(() => {
        if (!venueId) return;

        // Compute the minimal table set for this subscriber
        const neededTables = opts.tables || computeTablesForEntities(opts.entities);

        channelManager.subscribe(venueId, neededTables, stableCallbackRef.current);

        return () => {
            channelManager.unsubscribe(venueId, stableCallbackRef.current);
        };
    }, [venueId]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default useCommanderSync;
