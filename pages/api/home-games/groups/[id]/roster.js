/**
 * ROSTER API (phase40)
 * GET /api/commander/home-games/groups/[id]/roster
 *
 * Returns the unified roster (members ∪ followers) for a home group, from the
 * host/admin's perspective. Calls `get_home_group_roster(p_group_id, p_caller_user_id)`.
 * RPC enforces: caller must be group owner or approved admin.
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
        if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
        _supabase = createClient(url, key);
    }
    return _supabase;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
    try {
        if (req.method !== 'GET') {
            res.setHeader('Allow', ['GET']);
            return res.status(405).json({ success: false, error: 'Method not allowed' });
        }

        if (!applyRateLimit(req, res, LIMITS.read)) return;

        const user = await guardUser(req, res);
        if (!user) return;

        const { id: groupId } = req.query;
        if (!groupId || typeof groupId !== 'string' || !UUID_RE.test(groupId)) {
            return res.status(400).json({ success: false, error: 'Invalid group id' });
        }

        const { data: result, error } = await getSupabase().rpc('get_home_group_roster', {
            p_group_id: groupId,
            p_caller_user_id: user.id,
        });

        if (error) {
            // The RPC raises via RAISE EXCEPTION for NOT_AUTHORIZED and
            // AUTH_MISMATCH. Map these to 401/403 instead of bubbling 500.
            const msg = String(error.message || '');
            if (/AUTH_MISMATCH/.test(msg)) {
                return res.status(401).json({ success: false, error: 'AUTH_MISMATCH' });
            }
            if (/NOT_AUTHORIZED/.test(msg)) {
                return res.status(403).json({ success: false, error: 'NOT_AUTHORIZED' });
            }
            // eslint-disable-next-line no-console
            console.warn('[roster] RPC error:', error);
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }

        return res.status(200).json({ success: true, roster: result || [] });
    } catch (err) {
        try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
        // eslint-disable-next-line no-console
        console.warn('[roster]', err);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }
}
