/**
 * BROADCAST SYNC UTILITY
 * Centralized helper for cross-tab BroadcastChannel communication.
 * Eliminates fire-and-forget channel leaks by ensuring .close() is always called.
 *
 * Usage:
 *   import { broadcastSync } from '../../src/lib/broadcastSync';
 *   broadcastSync('smarter_poker_friends_sync', 'refresh');
 *   broadcastSync('smarter_poker_social_sync', { type: 'refresh_feed', ts: Date.now() });
 *
 * Self-tab suppression:
 *   import { broadcastSync, BROADCAST_TAB_ID } from '../../src/lib/broadcastSync';
 *   broadcastSync('channel', { tabId: BROADCAST_TAB_ID, action: 'refresh' });
 *   // In listener: if (msg.tabId === BROADCAST_TAB_ID) return; // skip own
 *
 * Debounced (prevents rapid-fire broadcasts):
 *   import { broadcastSyncDebounced } from '../../src/lib/broadcastSync';
 *   broadcastSyncDebounced('channel', 'refresh'); // 150ms debounce per channel
 */

/**
 * Unique identifier for this browser tab.
 * Used by listeners to skip re-processing their own broadcasts.
 */
export const BROADCAST_TAB_ID = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Debug logger — enabled via localStorage.setItem('broadcast_debug', '1') */
function debugLog(direction, channelName, message) {
    if (typeof localStorage === 'undefined') return;
    try {
        if (localStorage.getItem('broadcast_debug') !== '1') return;
        const ts = new Date().toISOString().slice(11, 23);
        console.debug(
            `%c[BC ${direction} ${ts}] %c${channelName}`,
            direction === '📡 SEND' ? 'color:#00E0FF;font-weight:bold' : 'color:#22c55e;font-weight:bold',
            'color:#FFD700',
            message
        );
    } catch { /* noop */ }
}

/**
 * Fire a one-shot BroadcastChannel message and immediately close.
 * Safe for SSG/SSR — silently no-ops if BroadcastChannel is unavailable.
 *
 * @param {string} channelName - The channel name to broadcast on
 * @param {*} message - The message payload (string, object, etc.)
 */
export function broadcastSync(channelName, message = 'refresh') {
    try {
        const bc = new BroadcastChannel(channelName);
        bc.postMessage(message);
        bc.close();
        debugLog('📡 SEND', channelName, message);
    } catch {
        // BroadcastChannel not supported (SSR, old browsers) — silent no-op
    }
}

/** Per-channel debounce timers */
const _debounceTimers = {};

/**
 * Debounced variant of broadcastSync.
 * Coalesces rapid-fire broadcasts on the same channel into a single message.
 * Useful in loops, rapid UI interactions, or batch mutations.
 *
 * @param {string} channelName - The channel name to broadcast on
 * @param {*} message - The message payload
 * @param {number} delayMs - Debounce delay in milliseconds (default 150)
 */
export function broadcastSyncDebounced(channelName, message = 'refresh', delayMs = 150) {
    if (_debounceTimers[channelName]) {
        clearTimeout(_debounceTimers[channelName]);
    }
    _debounceTimers[channelName] = setTimeout(() => {
        delete _debounceTimers[channelName];
        broadcastSync(channelName, message);
    }, delayMs);
}

/**
 * Create a persistent BroadcastChannel listener.
 * Returns a cleanup function to close the channel.
 * Use in useEffect return paths.
 *
 * @param {string} channelName - The channel name to listen on
 * @param {Function} handler - Callback invoked with the event data
 * @returns {Function} cleanup function that closes the channel
 */
export function listenBroadcast(channelName, handler) {
    let bc = null;
    try {
        bc = new BroadcastChannel(channelName);
        bc.onmessage = (event) => {
            debugLog('📥 RECV', channelName, event.data);
            handler(event.data);
        };
    } catch {
        // BroadcastChannel not supported — silent no-op
    }
    return () => {
        try { bc?.close(); } catch { /* noop */ }
    };
}

