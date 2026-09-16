/**
 * BROADCAST API (phase40)
 * POST /api/commander/home-games/groups/[id]/broadcast
 *
 * Fan-out an announcement to a home group's members and/or followers.
 * Calls `broadcast_to_home_group_roster(p_group_id, p_caller_user_id,
 *        p_title, p_body, p_include_members, p_include_followers, p_link_path)`.
 *
 * RPC gates: caller must be group owner or approved admin. Validates title/body
 * length (title ≤200, body ≤2000) and requires at least one audience.
 *
 * Body: {
 *   title: string,
 *   body: string,
 *   include_members?: boolean,   // default true
 *   include_followers?: boolean, // default true
 *   link_path?: string           // optional deep-link; defaults to group page
 * }
 */

import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
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
        if (!user) return;

        const { id: groupId } = req.query;
        if (!groupId || typeof groupId !== 'string' || !UUID_RE.test(groupId)) {
            return res.status(400).json({ success: false, error: 'Invalid group id' });
        }

        const {
            title,
            body,
            include_members = true,
            include_followers = true,
            link_path = null,
        } = req.body || {};

        if (typeof title !== 'string' || typeof body !== 'string') {
            return res.status(400).json({ success: false, error: 'title and body are required strings' });
        }
        const trimmedTitle = title.trim();
        const trimmedBody = body.trim();
        if (trimmedTitle.length === 0 || trimmedBody.length === 0) {
            return res.status(400).json({ success: false, error: 'title and body cannot be empty' });
        }
        if (trimmedTitle.length > 200) {
            return res.status(400).json({ success: false, error: 'title too long (max 200 chars)' });
        }
        if (trimmedBody.length > 2000) {
            return res.status(400).json({ success: false, error: 'body too long (max 2000 chars)' });
        }
        if (typeof include_members !== 'boolean' || typeof include_followers !== 'boolean') {
            return res.status(400).json({ success: false, error: 'include_members and include_followers must be boolean' });
        }
        if (!include_members && !include_followers) {
            return res.status(400).json({ success: false, error: 'At least one audience must be selected' });
        }
        if (link_path != null && (typeof link_path !== 'string' || link_path.length > 500 || !link_path.startsWith('/'))) {
            return res.status(400).json({ success: false, error: 'link_path must be a relative URL starting with /' });
        }

        const { data: result, error } = await getSupabase().rpc('broadcast_to_home_group_roster', {
            p_group_id: groupId,
            p_caller_user_id: user.id,
            p_title: trimmedTitle,
            p_body: trimmedBody,
            p_include_members: include_members,
            p_include_followers: include_followers,
            p_link_path: link_path,
        });

        if (error) {
            // eslint-disable-next-line no-console
            console.warn('[broadcast] RPC error:', error);
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }

        if (result && result.success === false) {
            const code = result.error || 'UNKNOWN';
            const status =
                code === 'AUTH_MISMATCH' ? 401 :
                code === 'NOT_GROUP_STAFF' ? 403 :
                code === 'GROUP_NOT_FOUND' ? 404 :
                code === 'MISSING_TITLE_OR_BODY' ? 400 :
                code === 'CONTENT_TOO_LONG' ? 400 :
                code === 'NO_AUDIENCE' ? 400 : 400;
            return res.status(status).json({ success: false, error: code });
        }

        return res.status(200).json({
            success: true,
            members_notified: result?.members_notified ?? 0,
            followers_notified: result?.followers_notified ?? 0,
            total: result?.total ?? 0,
        });
    } catch (err) {
        try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
        // eslint-disable-next-line no-console
        console.warn('[broadcast]', err);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }
}
