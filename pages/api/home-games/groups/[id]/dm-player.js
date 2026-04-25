/**
 * DM-PLAYER API (phase40)
 * POST /api/commander/home-games/groups/[id]/dm-player
 *
 * Opens a 1:1 DM from the authenticated caller to another user inside a
 * home-games context. Two routing modes:
 *
 *   (a) Roster DM (default) — if no `game_id` in body, calls
 *       `start_home_group_roster_dm(p_group_id, p_from_user_id, p_to_user_id, p_initial_message)`.
 *       Used when a host/admin clicks "Message" on a roster row.
 *       RPC gates: caller must be group owner/admin; target must be an
 *       approved member or follower and not banned.
 *
 *   (b) Game DM — if `game_id` is present in body, calls
 *       `start_home_game_player_dm(p_game_id, p_from_user_id, p_to_user_id, p_initial_message)`.
 *       Used for player↔player DMs tied to a specific game (e.g., late-RSVP
 *       handoff). RPC gates: both users must be approved members of the game's
 *       group, and at least one must have a relationship to the game (host,
 *       yes-RSVP, or seated).
 *
 * Body: { target_user_id: uuid, game_id?: uuid, initial_message?: string }
 * Returns: { success: true, conversation_id, ... } on 200, or { success: false, error } on non-2xx.
 */

import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!key) {
            // Fail loud on missing service-role key rather than silently falling
            // back to the anon key and getting inconsistent RLS behavior.
            throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
        }
        _supabase = createClient(url, key);
    }
    return _supabase;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', ['POST']);
            return res.status(405).json({ success: false, error: 'Method not allowed' });
        }

        if (!applyRateLimit(req, res, LIMITS.write)) return;

        const user = await guardUser(req, res);
        if (!user) return; // guardUser already sent 401

        const { id: groupId } = req.query;
        const { target_user_id, game_id, initial_message } = req.body || {};

        // Validate required fields.
        if (!groupId || typeof groupId !== 'string' || !UUID_RE.test(groupId)) {
            return res.status(400).json({ success: false, error: 'Invalid group id' });
        }
        if (!target_user_id || typeof target_user_id !== 'string' || !UUID_RE.test(target_user_id)) {
            return res.status(400).json({ success: false, error: 'target_user_id must be a UUID' });
        }
        if (target_user_id === user.id) {
            return res.status(400).json({ success: false, error: 'Cannot DM yourself' });
        }
        if (game_id != null && (typeof game_id !== 'string' || !UUID_RE.test(game_id))) {
            return res.status(400).json({ success: false, error: 'Invalid game_id' });
        }
        if (initial_message != null && typeof initial_message !== 'string') {
            return res.status(400).json({ success: false, error: 'initial_message must be a string' });
        }
        if (typeof initial_message === 'string' && initial_message.length > 4000) {
            return res.status(400).json({ success: false, error: 'initial_message too long (max 4000 chars)' });
        }

        const trimmedMessage = typeof initial_message === 'string' ? initial_message.trim() : null;
        const messageOrNull = trimmedMessage && trimmedMessage.length > 0 ? trimmedMessage : null;

        // Route to the right RPC based on whether this is a game-context DM.
        let result, error;
        if (game_id) {
            ({ data: result, error } = await getSupabase().rpc('start_home_game_player_dm', {
                p_game_id: game_id,
                p_from_user_id: user.id,
                p_to_user_id: target_user_id,
                p_initial_message: messageOrNull,
            }));
        } else {
            ({ data: result, error } = await getSupabase().rpc('start_home_group_roster_dm', {
                p_group_id: groupId,
                p_from_user_id: user.id,
                p_to_user_id: target_user_id,
                p_initial_message: messageOrNull,
            }));
        }

        if (error) {
            // eslint-disable-next-line no-console
            console.warn('[dm-player] RPC error:', error);
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }

        // The RPCs return JSONB with {success, error, conversation_id, ...}.
        // Translate business-logic failures (success=false) into 4xx for the client.
        if (result && result.success === false) {
            const code = result.error || 'UNKNOWN';
            const status =
                code === 'AUTH_MISMATCH' ? 401 :
                code === 'NOT_GROUP_STAFF' ? 403 :
                code === 'GAME_NOT_FOUND' ? 404 :
                code === 'SELF_DM' ? 400 :
                code === 'MISSING_PARAMS' ? 400 :
                code === 'MESSAGE_TOO_LONG' ? 400 :
                code === 'BANNED' ? 403 :
                code === 'TARGET_BANNED' ? 403 :
                code === 'TARGET_NOT_IN_ROSTER' ? 403 :
                code === 'FROM_NOT_APPROVED_MEMBER' ? 403 :
                code === 'TO_NOT_APPROVED_MEMBER' ? 403 :
                code === 'NO_GAME_RELATIONSHIP' ? 403 :
                code === 'CONVERSATION_FAILED' ? 500 : 400;
            return res.status(status).json({ success: false, error: code, detail: result });
        }

        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
        // eslint-disable-next-line no-console
        console.warn('[dm-player]', err);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }
}
