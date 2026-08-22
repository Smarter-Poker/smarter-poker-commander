/**
 * useBusBridge - Cross-Tab EventBus ↔ BroadcastChannel Bridge
 * ═══════════════════════════════════════════════════════════════
 *
 * Bridges the in-page EventBus with the cross-tab BroadcastChannel:
 *   1. When busEmit.dataMutated('waitlist') fires → broadcastChange('waitlist')
 *   2. When a BroadcastChannel message arrives → emits DATA_MUTATED on EventBus
 *
 * This means any dataMutated() call automatically syncs across all open tabs,
 * and cross-tab changes trigger EventBus listeners on the receiving tab.
 *
 * Usage: Call once in CommanderLayout or _app.js
 *   import useBusBridge from '@/lib/commander/useBusBridge';
 *   useBusBridge();
 */
import { useEffect, useRef } from 'react';
import { eventBus, EventType } from '../../engine/EventBus';
import { broadcastChange } from './useCommanderSync';
import { listenBroadcast, broadcastSync } from '../broadcastSync';

const CHANNEL_NAME = 'commander_bus_bridge';

export default function useBusBridge() {
    const channelRef = useRef(null);
    const selfEmitsRef = useRef(new Set());

    useEffect(() => {
        if (typeof window === 'undefined') return;

        // ── Direction 1: EventBus → BroadcastChannel ──
        // When DATA_MUTATED fires locally, broadcast to other tabs
        const unsubMutated = eventBus.on(EventType.DATA_MUTATED, (event) => {
            const entity = event.payload?.entity;
            if (!entity) return;

            // Track this entity to avoid echo loops
            const key = `${entity}_${Date.now()}`;
            selfEmitsRef.current.add(key);
            setTimeout(() => selfEmitsRef.current.delete(key), 2000);

            // Broadcast via our secure bridge utility to other tabs
            broadcastChange(entity);
            broadcastSync(CHANNEL_NAME, { type: 'bus_bridge', entity, ts: Date.now() });
        });

        // ── Direction 2: BroadcastChannel → EventBus ──
        // When another tab broadcasts, emit DATA_MUTATED on this tab's EventBus
        const cleanupBridgeListener = listenBroadcast(CHANNEL_NAME, (msg) => {
            if (msg?.type !== 'bus_bridge') return;
            const entity = msg.entity;
            if (!entity) return;

            // Suppress echo: don't re-emit our own broadcasts
            const recentSelf = Array.from(selfEmitsRef.current).some(k => k.startsWith(`${entity}_`));
            if (recentSelf) return;

            // Emit on local EventBus so local listeners react
            eventBus.emit(EventType.DATA_MUTATED, { entity, remote: true }, 'BusBridge');
        });

        return () => {
            unsubMutated();
            cleanupBridgeListener();
        };
    }, []);
}
