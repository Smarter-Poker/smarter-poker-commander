/**
 * My Commander Accounts — multi-club / home-game switcher backend
 *
 * GET  — list every Commander context the authenticated user can operate:
 *          clubs:       active/trialing commander_subscriptions they OWN
 *                       (with joined poker_venues row)
 *          home_groups: commander_home_groups they OWN
 *        Returns { clubs: [...], home_groups: [...] }
 *
 * POST — switch the active club context. Body: { venue_id }.
 *        Verifies the caller OWNS an active/trialing subscription for that
 *        venue, then returns { subscription, staff_session } in the exact
 *        shape /api/check-subscription returns at login, so the client can
 *        rebuild commander_venue / commander_subscription / commander_staff
 *        localStorage identically. staff_session is HMAC-signed server-side
 *        (signStaffSession) — never forgeable client-side.
 *
 * Called via /api/commander/my-commander-accounts (next.config rewrite).
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { signStaffSession } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { checkMemoryRateLimit } from '../../src/lib/commander/rateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

async function getAuthedUser(req) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    const { data, error } = await getSupabase().auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
}

export default async function handler(req, res) {
    try {
        const limit = req.method === 'GET' ? LIMITS.read : LIMITS.auth;
        if (!applyRateLimit(req, res, limit)) return;

        // IP rate limit on switches (mirrors check-subscription abuse guard)
        if (req.method === 'POST') {
            const fwd = req.headers['x-forwarded-for'];
            const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
            const rl = checkMemoryRateLimit(`swvenue:${ip}`, 10, 60000);
            if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
        }

        if (req.method !== 'GET' && req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const user = await getAuthedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (req.method === 'GET') {
            const [subsRes, groupsRes] = await Promise.all([
                getSupabase()
                    .from('commander_subscriptions')
                    .select('id, venue_id, tier, status, created_at, venue:poker_venues(id, name, city, state)')
                    .eq('owner_id', user.id)
                    .in('status', ['active', 'trialing'])
                    .order('created_at', { ascending: true }),
                getSupabase()
                    .from('commander_home_groups')
                    .select('id, name, city, state, member_count')
                    .eq('owner_id', user.id)
                    .order('name', { ascending: true }),
            ]);

            if (subsRes.error) {
                console.warn('[my-commander-accounts] subs error:', subsRes.error.message);
                return res.status(500).json({ error: 'Failed to load clubs' });
            }
            if (groupsRes.error) {
                console.warn('[my-commander-accounts] groups error:', groupsRes.error.message);
            }

            return res.status(200).json({
                clubs: subsRes.data || [],
                home_groups: groupsRes.error ? [] : (groupsRes.data || []),
            });
        }

        // POST — switch active club
        const venueId = req.body?.venue_id;
        if (venueId === undefined || venueId === null || venueId === '') {
            return res.status(400).json({ error: 'venue_id required' });
        }

        const { data: subs, error } = await getSupabase()
            .from('commander_subscriptions')
            .select('*, venue:poker_venues(*)')
            .eq('owner_id', user.id)
            .eq('venue_id', venueId)
            .in('status', ['active', 'trialing'])
            .order('created_at', { ascending: false })
            .limit(1);

        if (error) {
            console.warn('[my-commander-accounts] switch error:', error.message);
            return res.status(500).json({ error: 'Failed to switch venue' });
        }

        const subscription = subs?.[0] || null;
        if (!subscription) {
            // Ownership check failed — no active subscription for this venue
            return res.status(403).json({ error: 'You do not own an active subscription for this venue' });
        }

        const staff_session = signStaffSession({
            user_id: user.id,
            venue_id: subscription.venue_id,
            role: 'owner',
        });

        return res.status(200).json({ subscription, staff_session });
    } catch (err) {
        try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
        console.warn('[API Error] my-commander-accounts:', err);
        if (!res.headersSent) return res.status(500).json({ error: 'Internal server error' });
    }
}
