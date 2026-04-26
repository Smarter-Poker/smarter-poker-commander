/**
 * 🚌 GLOBAL EVENT BUS — HARDENED
 * ═══════════════════════════════════════════════════════════════════════════
 * The Central Nervous System of PokerIQ + Club Commander.
 * All engines, services, and components communicate through this bus.
 *
 * HARDENING [RAT-BUS-HARDEN — March 9, 2026]:
 *   1) busEmit works as BOTH a function AND an object (via Proxy).
 *      - busEmit('training:session-complete', payload)  ← function call
 *      - busEmit.diamondsEarned(100, 'streak')          ← named method
 *      Both patterns are safe and will never crash.
 *   2) eventBus.emit is SSR-safe — silently no-ops on the server.
 *   3) All emit paths wrapped in try/catch — bus errors never crash pages.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const EventType = {
    // ── Training / GTO ──
    STREAK_MILESTONE: 'STREAK_MILESTONE',
    STREAK_LOST: 'STREAK_LOST',
    COMBO_LEVEL_UP: 'COMBO_LEVEL_UP',
    DIAMONDS_EARNED: 'DIAMONDS_EARNED',
    DIAMONDS_SPENT: 'DIAMONDS_SPENT',
    DECISION_CORRECT: 'DECISION_CORRECT',
    DECISION_INCORRECT: 'DECISION_INCORRECT',
    HAND_COMPLETE: 'HAND_COMPLETE',
    SESSION_START: 'SESSION_START',
    SESSION_END: 'SESSION_END',
    LEVEL_UNLOCKED: 'LEVEL_UNLOCKED',
    MASTERY_ACHIEVED: 'MASTERY_ACHIEVED',
    TIMER_WARNING: 'TIMER_WARNING',
    TIMER_CRITICAL: 'TIMER_CRITICAL',
    TIMER_EXPIRED: 'TIMER_EXPIRED',
    SCREEN_SHAKE: 'SCREEN_SHAKE',
    SCREEN_FLASH: 'SCREEN_FLASH',
    CELEBRATION: 'CELEBRATION',
    SOUND_PLAY: 'SOUND_PLAY',

    // ── Commander Operations ──
    WAITLIST_PLAYER_ADDED: 'WAITLIST_PLAYER_ADDED',
    WAITLIST_PLAYER_CALLED: 'WAITLIST_PLAYER_CALLED',
    WAITLIST_PLAYER_SEATED: 'WAITLIST_PLAYER_SEATED',
    TABLE_OPENED: 'TABLE_OPENED',
    TABLE_CLOSED: 'TABLE_CLOSED',
    STAFF_CLOCKED_IN: 'STAFF_CLOCKED_IN',
    STAFF_CLOCKED_OUT: 'STAFF_CLOCKED_OUT',
    COMP_ISSUED: 'COMP_ISSUED',
    INCIDENT_REPORTED: 'INCIDENT_REPORTED',
    TOURNAMENT_STARTED: 'TOURNAMENT_STARTED',
    TOURNAMENT_REGISTERED: 'TOURNAMENT_REGISTERED',
    TOURNAMENT_LEVEL_CHANGE: 'TOURNAMENT_LEVEL_CHANGE',
    BOUNTY_AWARDED: 'BOUNTY_AWARDED',
    MYSTERY_BOUNTY_REVEALED: 'MYSTERY_BOUNTY_REVEALED',
    TOURNAMENT_COMPLETE: 'TOURNAMENT_COMPLETE',
    TOURNAMENT_CANCELLED: 'TOURNAMENT_CANCELLED',
    HAND_REPLAYED: 'HAND_REPLAYED',
    DATA_MUTATED: 'DATA_MUTATED',

    // ── Geeves AI Help Bot ──
    GEEVES_QUESTION_MISSED: 'GEEVES_QUESTION_MISSED',
    GEEVES_KB_UPDATED: 'GEEVES_KB_UPDATED',
    GEEVES_OPENED: 'GEEVES_OPENED',
    BUG_REPORT_SUBMITTED: 'BUG_REPORT_SUBMITTED',

    // ── ORB-6: The Wire (Messenger / WebRTC) ──
    MESSAGE_SENT: 'MESSAGE_SENT',
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    CALL_STARTED: 'CALL_STARTED',
    CALL_ENDED: 'CALL_ENDED',
    BROADCAST_SENT: 'BROADCAST_SENT',
    MESSAGE_BOOKMARKED: 'MESSAGE_BOOKMARKED',
    MESSAGE_PINNED: 'MESSAGE_PINNED',
    MESSAGE_FORWARDED: 'MESSAGE_FORWARDED',
    MESSAGE_REACTED: 'MESSAGE_REACTED',
    MESSAGE_EDITED: 'MESSAGE_EDITED',
    VOICE_MESSAGE_SENT: 'VOICE_MESSAGE_SENT',
    MESSENGER_SEARCH: 'MESSENGER_SEARCH',

    // ── Social & Friends ──
    FRIEND_REQUEST_SENT: 'FRIEND_REQUEST_SENT',
    FRIEND_REQUEST_ACCEPTED: 'FRIEND_REQUEST_ACCEPTED',
    NOTIFICATIONS_READ: 'NOTIFICATIONS_READ',
    SOCIAL_POST_CREATED: 'SOCIAL_POST_CREATED',
    SOCIAL_POST_LIKED: 'SOCIAL_POST_LIKED',
    SOCIAL_COMMENT_ADDED: 'SOCIAL_COMMENT_ADDED',
    SOCIAL_POST_BOOKMARKED: 'SOCIAL_POST_BOOKMARKED',
    SOCIAL_POST_SHARED: 'SOCIAL_POST_SHARED',
    SOCIAL_FOLLOW_CHANGED: 'SOCIAL_FOLLOW_CHANGED',
    SOCIAL_FEED_REFRESHED: 'SOCIAL_FEED_REFRESHED',
    VENUE_CHECKIN_CREATED: 'VENUE_CHECKIN_CREATED',
    // ── Social Pages real-time synchronization ──
    SOCIAL_REACTION_UPDATE: 'SOCIAL_REACTION_UPDATE',
    SOCIAL_COMMENT_UPDATE: 'SOCIAL_COMMENT_UPDATE',
    SOCIAL_POST_DELETED: 'SOCIAL_POST_DELETED',

    // ── Club Arena Operations ──
    ANNOUNCEMENT_CREATED: 'ANNOUNCEMENT_CREATED',
    TABLE_CREATED: 'TABLE_CREATED',
    PLAYER_KICKED: 'PLAYER_KICKED',
    MEMBER_UPDATED: 'MEMBER_UPDATED',
    PLAYER_JOINED: 'PLAYER_JOINED',
    PLAYER_LEFT: 'PLAYER_LEFT',
    CASHOUT_CANCELLED: 'CASHOUT_CANCELLED',
    CASHOUT_REQUESTED: 'CASHOUT_REQUESTED',
    CHIPS_DISTRIBUTED: 'CHIPS_DISTRIBUTED',
    CASHOUT_APPROVED: 'CASHOUT_APPROVED',
    BALANCE_UPDATED: 'BALANCE_UPDATED',
    AGENT_UPDATED: 'AGENT_UPDATED',
    ANTI_CHEAT_FLAG_CREATED: 'ANTI_CHEAT_FLAG_CREATED',
    CASHIER_BALANCE_CHANGED: 'CASHIER_BALANCE_CHANGED',

    // ── Parity port from Club-Arena SPA (March 2026) ──
    CLUB_UPDATED: 'CLUB_UPDATED',
    SETTINGS_CHANGED: 'SETTINGS_CHANGED',
    TABLE_PAUSED: 'TABLE_PAUSED',
    TABLE_RESUMED: 'TABLE_RESUMED',
    CREDIT_UPDATED: 'CREDIT_UPDATED',
    RAKEBACK_CLAIMED: 'RAKEBACK_CLAIMED',

    // ── Poker Near Me & Venues ──
    VENUE_SAVED: 'venue:favorite',
    VENUE_UNSAVED: 'venue:unfavorite',
};

// ─── SSR Safety Check ──────────────────────────────────────────
const _isClient = typeof window !== 'undefined';

class GlobalEventBus {
    constructor() {
        this.listeners = new Map();
        this.history = [];
        this.instanceId = _isClient ? Math.random().toString(36).substring(2, 9) : 'server';
        
        if (_isClient) {
            try {
                this.channel = new BroadcastChannel('smarter_poker_bus');
                this.channel.onmessage = (event) => {
                    const { type, payload, source, instanceId } = event.data || {};
                    // Ignore echo
                    if (instanceId === this.instanceId) return;
                    if (type) {
                        this.emit(type, payload, source, true);
                    }
                };
            } catch (err) {
                console.warn('BroadcastChannel not supported or failed to initialize:', err);
            }
        }
    }

    on(eventType, callback) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType).add(callback);

        return () => {
            this.listeners.get(eventType)?.delete(callback);
        };
    }

    /**
     * Remove a specific listener for an event type.
     * This is the complement to .on() — used by 20+ call sites that
     * prefer the explicit .off(type, callback) pattern over the
     * unsubscribe function returned by .on().
     */
    off(eventType, callback) {
        this.listeners.get(eventType)?.delete(callback);
    }

    /**
     * Emit an event. SSR-safe: silently no-ops on the server so pages
     * that emit during useMemo/render never crash during SSR.
     * @param {string} eventType 
     * @param {object} payload 
     * @param {string} source 
     * @param {boolean} fromBroadcast - INTERNAL: Prevents infinite broadcast bouncing
     */
    emit(eventType, payload = {}, source = 'system', fromBroadcast = false) {
        // [HARDENING] SSR guard — emit is a no-op on the server.
        // Events only matter in the browser where listeners exist.
        if (!_isClient) return;

        try {
            const event = {
                type: eventType,
                payload,
                timestamp: Date.now(),
                source
            };

            this.history.unshift(event);
            if (this.history.length > 100) {
                this.history.pop();
            }

            // Sync to other tabs via BroadcastChannel
            if (!fromBroadcast && this.channel) {
                try {
                    this.channel.postMessage({ type: eventType, payload, source, instanceId: this.instanceId });
                } catch (bcError) { console.warn('[App] Handled exception:', bcError?.message || bcError); }
            }

            const callbacks = this.listeners.get(eventType);
            if (callbacks) {
                callbacks.forEach(callback => {
                    try {
                        callback(event);
                    } catch (error) {
                        console.warn(`Event bus error for ${eventType}:`, error);
                    }
                });
            }

            if (window.location?.hostname === 'localhost' && !fromBroadcast) {
                console.debug(`🚌 [BUS] ${eventType}`, payload);
            }
        } catch (err) { console.warn('[EventBus] Emit error:', err?.message || err); }
    }

    getHistory(limit = 10) {
        return this.history.slice(0, limit);
    }
}

export const eventBus = new GlobalEventBus();

if (_isClient) {
    window.SmarterPokerEventBus = eventBus;
}

// ─── Staff Context Helper ──────────────────────────────────────
function _getStaffCtx() {
    if (!_isClient) return {};
    try {
        const s = JSON.parse(localStorage.getItem('commander_staff') || '{}');
        return { staffId: s.id || null, venueId: s.venue_id || null, role: s.role || null, staffName: s.name || null };
    } catch { return {}; }
}

// ─── Convenience Named Methods ─────────────────────────────────
const _busEmitMethods = {
    // ── Training / GTO ──
    diamondsEarned: (amount, reason) =>
        eventBus.emit(EventType.DIAMONDS_EARNED, { amount, reason }, 'DiamondEngine'),

    diamondsSpent: (amount, reason) =>
        eventBus.emit(EventType.DIAMONDS_SPENT, { amount, reason }, 'DiamondEngine'),

    decisionCorrect: (streak) =>
        eventBus.emit(EventType.DECISION_CORRECT, { streak }, 'TrainingArena'),

    decisionIncorrect: (lostStreak, { userAction, bestAction, scenario } = {}) =>
        eventBus.emit(EventType.DECISION_INCORRECT, { lostStreak, userAction, bestAction, scenario }, 'TrainingArena'),

    screenShake: (intensity = 'medium') =>
        eventBus.emit(EventType.SCREEN_SHAKE, { intensity }, 'Effects'),

    screenFlash: (color, duration = 200) =>
        eventBus.emit(EventType.SCREEN_FLASH, { color, duration }, 'Effects'),

    celebration: (type) =>
        eventBus.emit(EventType.CELEBRATION, { type }, 'Celebration'),

    timerWarning: () =>
        eventBus.emit(EventType.TIMER_WARNING, {}, 'PressureTimer'),

    timerCritical: () =>
        eventBus.emit(EventType.TIMER_CRITICAL, {}, 'PressureTimer'),

    timerExpired: () =>
        eventBus.emit(EventType.TIMER_EXPIRED, {}, 'PressureTimer'),

    sessionStart: (source = 'FlowState') =>
        eventBus.emit(EventType.SESSION_START, { ..._getStaffCtx() }, source),

    sessionEnd: (source = 'FlowState') =>
        eventBus.emit(EventType.SESSION_END, { ..._getStaffCtx() }, source),

    // ── Commander Operations ──
    waitlistPlayerAdded: (playerName, gameType) =>
        eventBus.emit(EventType.WAITLIST_PLAYER_ADDED, { playerName, gameType, ..._getStaffCtx() }, 'WaitlistDesk'),

    waitlistPlayerCalled: (playerName, gameType) =>
        eventBus.emit(EventType.WAITLIST_PLAYER_CALLED, { playerName, gameType, ..._getStaffCtx() }, 'WaitlistDesk'),

    waitlistPlayerSeated: (playerName, tableNumber, seatNumber) =>
        eventBus.emit(EventType.WAITLIST_PLAYER_SEATED, { playerName, tableNumber, seatNumber, ..._getStaffCtx() }, 'WaitlistDesk'),

    tableOpened: (tableNumber, gameType) =>
        eventBus.emit(EventType.TABLE_OPENED, { tableNumber, gameType, ..._getStaffCtx() }, 'FloorManager'),

    tableClosed: (tableNumber) =>
        eventBus.emit(EventType.TABLE_CLOSED, { tableNumber, ..._getStaffCtx() }, 'FloorManager'),

    staffClockedIn: (staffName) =>
        eventBus.emit(EventType.STAFF_CLOCKED_IN, { staffName, ..._getStaffCtx() }, 'TimeClock'),

    staffClockedOut: (staffName) =>
        eventBus.emit(EventType.STAFF_CLOCKED_OUT, { staffName, ..._getStaffCtx() }, 'TimeClock'),

    compIssued: (memberName, amount, category) =>
        eventBus.emit(EventType.COMP_ISSUED, { memberName, amount, category, ..._getStaffCtx() }, 'CompSystem'),

    incidentReported: (type, severity) =>
        eventBus.emit(EventType.INCIDENT_REPORTED, { type, severity, ..._getStaffCtx() }, 'IncidentManager'),

    tournamentStarted: (tournamentName, entryCount) =>
        eventBus.emit(EventType.TOURNAMENT_STARTED, { tournamentName, entryCount, ..._getStaffCtx() }, 'TournamentDirector'),

    tournamentLevelChange: (level, blinds) =>
        eventBus.emit(EventType.TOURNAMENT_LEVEL_CHANGE, { level, blinds, ..._getStaffCtx() }, 'TournamentDirector'),

    bountyAwarded: (playerName, amount, bountyType) =>
        eventBus.emit(EventType.BOUNTY_AWARDED, { playerName, amount, bountyType }, 'TournamentDirector'),

    mysteryBountyRevealed: (playerName, amount, tierLabel) =>
        eventBus.emit(EventType.MYSTERY_BOUNTY_REVEALED, { playerName, amount, tierLabel }, 'TournamentDirector'),

    tournamentComplete: (tournamentName, winner) =>
        eventBus.emit(EventType.TOURNAMENT_COMPLETE, { tournamentName, winner }, 'TournamentDirector'),

    tournamentRegistered: (tournamentId, clubId) =>
        eventBus.emit(EventType.TOURNAMENT_REGISTERED, { tournamentId, clubId }, 'ClubArena'),

    tournamentCancelled: (tournamentId, clubId) =>
        eventBus.emit(EventType.TOURNAMENT_CANCELLED, { tournamentId, clubId }, 'ClubArena'),

    handReplayed: (handId, clubId) =>
        eventBus.emit(EventType.HAND_REPLAYED, { handId, clubId }, 'ClubArena'),

    dataMutated: (entity) =>
        eventBus.emit(EventType.DATA_MUTATED, { entity, ..._getStaffCtx() }, 'DataSync'),

    // ── Geeves AI Help Bot ──
    geevesQuestionMissed: (question, page) =>
        eventBus.emit(EventType.GEEVES_QUESTION_MISSED, { question, page }, 'GeevesChat'),

    geevesKBUpdated: (questionId, addedToKB) =>
        eventBus.emit(EventType.GEEVES_KB_UPDATED, { questionId, addedToKB }, 'GeevesAdmin'),

    geevesOpened: () =>
        eventBus.emit(EventType.GEEVES_OPENED, {}, 'GeevesOrb'),

    bugReportSubmitted: (ticketId, priority, system) =>
        eventBus.emit(EventType.BUG_REPORT_SUBMITTED, { ticketId, priority, system }, 'BugWidget'),

    // ── ORB-6: The Wire (Messenger / WebRTC) ──
    messageSent: (conversationId, recipientId) =>
        eventBus.emit(EventType.MESSAGE_SENT, { conversationId, recipientId }, 'Messenger'),

    messageReceived: (conversationId, senderId) =>
        eventBus.emit(EventType.MESSAGE_RECEIVED, { conversationId, senderId }, 'Messenger'),

    callStarted: (callType, roomName, otherUserId) =>
        eventBus.emit(EventType.CALL_STARTED, { callType, roomName, otherUserId }, 'LiveKitCall'),

    callEnded: (callType, roomName) =>
        eventBus.emit(EventType.CALL_ENDED, { callType, roomName }, 'LiveKitCall'),

    broadcastSent: (conversationCount) =>
        eventBus.emit(EventType.BROADCAST_SENT, { conversationCount }, 'Messenger'),

    messageBookmarked: (conversationId, messageId) =>
        eventBus.emit(EventType.MESSAGE_BOOKMARKED, { conversationId, messageId }, 'Messenger'),

    messagePinned: (conversationId, messageId) =>
        eventBus.emit(EventType.MESSAGE_PINNED, { conversationId, messageId }, 'Messenger'),

    messageForwarded: (fromConversationId, toConversationId) =>
        eventBus.emit(EventType.MESSAGE_FORWARDED, { fromConversationId, toConversationId }, 'Messenger'),

    messageReacted: (conversationId, messageId, emoji) =>
        eventBus.emit(EventType.MESSAGE_REACTED, { conversationId, messageId, emoji }, 'Messenger'),

    messageEdited: (conversationId, messageId) =>
        eventBus.emit(EventType.MESSAGE_EDITED, { conversationId, messageId }, 'Messenger'),

    voiceMessageSent: (conversationId, duration) =>
        eventBus.emit(EventType.VOICE_MESSAGE_SENT, { conversationId, duration }, 'Messenger'),

    messengerSearch: (query) =>
        eventBus.emit(EventType.MESSENGER_SEARCH, { query }, 'Messenger'),

    // ── Social & Friends ──
    friendRequestSent: (friendId) =>
        eventBus.emit(EventType.FRIEND_REQUEST_SENT, { friendId }, 'FriendsPage'),

    friendRequestAccepted: (friendId) =>
        eventBus.emit(EventType.FRIEND_REQUEST_ACCEPTED, { friendId }, 'FriendsPage'),

    notificationsRead: (count) =>
        eventBus.emit(EventType.NOTIFICATIONS_READ, { count }, 'NotificationsPage'),

    socialPostCreated: (postId, authorId) =>
        eventBus.emit(EventType.SOCIAL_POST_CREATED, { postId, authorId }, 'SocialFeed'),

    socialPostLiked: (postId, userId, meta = {}) =>
        eventBus.emit(EventType.SOCIAL_POST_LIKED, { postId, userId, added: meta.added, reactionType: meta.reactionType }, 'SocialFeed'),

    socialCommentAdded: (postId, authorId, meta = {}) =>
        eventBus.emit(EventType.SOCIAL_COMMENT_ADDED, { postId, authorId, ...meta }, 'SocialFeed'),

    socialPostBookmarked: (postId, userId, meta = {}) =>
        eventBus.emit(EventType.SOCIAL_POST_BOOKMARKED, { postId, userId, added: meta.added }, 'SocialFeed'),

    socialPostShared: (postId, userId) =>
        eventBus.emit(EventType.SOCIAL_POST_SHARED, { postId, userId }, 'SocialFeed'),

    socialFollowChanged: (followedId, followerId, meta = {}) =>
        eventBus.emit(EventType.SOCIAL_FOLLOW_CHANGED, { followedId, followerId, added: meta.added }, 'SocialFeed'),

    socialFeedRefreshed: () =>
        eventBus.emit(EventType.SOCIAL_FEED_REFRESHED, {}, 'SocialFeed'),

    venueCheckinCreated: (venueId, venueName, userId) =>
        eventBus.emit(EventType.VENUE_CHECKIN_CREATED, { venueId, venueName, userId }, 'SocialCheckIn'),

    // ── Poker Near Me & Venues ──
    venueSaved: (venueId, venueName) =>
        eventBus.emit(EventType.VENUE_SAVED, { venueId, venueName }, 'PokerNearMe'),

    venueUnsaved: (venueId) =>
        eventBus.emit(EventType.VENUE_UNSAVED, { venueId }, 'PokerNearMe'),
};

// ═══════════════════════════════════════════════════════════════════════════
// HARDENED busEmit — works as BOTH a function AND an object.
//
//   busEmit('training:session-complete', { game_id: 'x' })  ← WORKS (function)
//   busEmit.diamondsEarned(100, 'streak')                   ← WORKS (method)
//
// This uses a Proxy that intercepts function calls (apply) and passes
// property access through to the named methods object. If anyone calls
// busEmit as a function, it delegates to eventBus.emit. If they access
// busEmit.someMethod, they get the convenience method. Either way: no crash.
// ═══════════════════════════════════════════════════════════════════════════

function _busEmitFn(eventType, payload = {}, source = 'busEmit') {
    try {
        eventBus.emit(eventType, payload, source);
    } catch (err) {
        if (_isClient) console.warn('🚌 [busEmit] Error:', err);
    }
}

// Copy all named methods onto the function so busEmit.diamondsEarned etc. work
Object.assign(_busEmitFn, _busEmitMethods);

/**
 * @type {typeof _busEmitMethods & ((eventType: string, payload?: object, source?: string) => void)}
 *
 * Callable as a function OR accessible as an object of named methods.
 * SSR-safe. Crash-proof. Will never take down the server.
 */
export const busEmit = _busEmitFn;

