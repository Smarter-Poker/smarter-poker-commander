/**
 * My Commander Accounts - multi-club / home-game switcher backend
 *
 * GET  - list every Commander context the authenticated user can operate:
 *          clubs:        active/trialing commander_subscriptions they OWN
 *                        (deduped per venue, newest sub wins, with joined
 *                        poker_venues row + club logo from venue settings)
 *          staff_venues: venues where they are ACTIVE STAFF (not owner) and
 *                        the venue has an active/trialing subscription;
 *                        includes their staff role
 *          home_groups:  commander_home_groups they own OR administer
 *                        (member role owner/admin, status approved), deduped
 *        Returns { clubs: [...], staff_venues: [...], home_groups: [...] }
 *
 * POST - switch the active venue context. Body: { venue_id }.
 *        Owner path:  caller OWNS an active/trialing subscription for that
 *                     venue -> owner staff_session + full owner permissions.
 *        Staff path:  caller has an ACTIVE commander_staff row for that
 *                     venue -> staff_session signed with their REAL role and
 *                     permissions (DEFAULT_PERMISSIONS[role] merged with the
 *                     row's overrides), exactly what PIN login would grant.
 *        Response { subscription, staff_session, role, permissions } in the
 *        /api/check-subscription shape so the client can rebuild the
 *        commander_venue / commander_subscription / commander_staff
 *        localStorage state identically. staff_session is HMAC-signed
 *        server-side (signStaffSession) - never forgeable client-side.
 *
 * Called via /api/commander/my-commander-accounts (next.config rewrite).
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { signStaffSession, DEFAULT_PERMISSIONS } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { checkMemoryRateLimit } from '../../src/lib/commander/rateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';
import { logAction, AuditActions } from '../../src/lib/commander/audit';

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

// Owner permissions - mirrors the map login.js has always written for owners.
const OWNER_PERMISSIONS = {
    manage_games: true,
    manage_waitlist: true,
    manage_staff: true,
    manage_tables: true,
    manage_tournaments: true,
    manage_settings: true,
    view_analytics: true,
    view_reports: true,
    send_announcements: true,
};

// Newest-first dedupe: one subscription per venue_id.
function dedupeSubsByVenue(subs) {
    const byVenue = new Map();
    for (const sub of subs || []) {
        const prev = byVenue.get(sub.venue_id);
        if (!prev || new Date(sub.created_at) > new Date(prev.created_at)) {
            byVenue.set(sub.venue_id, sub);
        }
    }
    return Array.from(byVenue.values());
}

export default async function handler(req, res) {
    try {
        if (req.method !== 'GET' && req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const limit = req.method === 'GET' ? LIMITS.read : LIMITS.auth;
        if (!applyRateLimit(req, res, limit)) return;

        // IP rate limit on switches (mirrors check-subscription abuse guard)
        if (req.method === 'POST') {
            const fwd = req.headers['x-forwarded-for'];
            const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
            const rl = checkMemoryRateLimit(`swvenue:${ip}`, 10, 60000);
            if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
        }

        const user = await getAuthedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const db = getSupabase();

        if (req.method === 'GET') {
            const [subsRes, staffRes, ownedGroupsRes, memberGroupsRes] = await Promise.all([
                db.from('commander_subscriptions')
                    .select('id, venue_id, tier, status, created_at, venue:poker_venues(id, name, city, state)')
                    .eq('owner_id', user.id)
                    .in('status', ['active', 'trialing'])
                    .order('created_at', { ascending: true }),
                db.from('commander_staff')
                    .select('venue_id, role, venue:poker_venues(id, name, city, state)')
                    .or(`linked_user_id.eq.${user.id},user_id.eq.${user.id}`)
                    .eq('is_active', true),
                db.from('commander_home_groups')
                    .select('id, name, city, state, member_count')
                    .eq('owner_id', user.id)
                    .order('name', { ascending: true }),
                db.from('commander_home_members')
                    .select('role, status, group:commander_home_groups(id, name, city, state, member_count)')
                    .eq('user_id', user.id)
                    .in('role', ['owner', 'admin'])
                    .eq('status', 'approved'),
            ]);

            if (subsRes.error) {
                console.warn('[my-commander-accounts] subs error:', subsRes.error.message);
                return res.status(500).json({ error: 'Failed to load clubs' });
            }

            const clubs = dedupeSubsByVenue(subsRes.data);
            const ownedVenueIds = new Set(clubs.map(c => c.venue_id));

            // Staff venues: exclude venues the user already owns, dedupe, and
            // keep only venues with a live subscription (otherwise Commander
            // is dark there anyway).
            let staff_venues = [];
            if (!staffRes.error && staffRes.data?.length) {
                const seen = new Set();
                const candidates = staffRes.data.filter(s => {
                    if (!s.venue_id || ownedVenueIds.has(s.venue_id) || seen.has(s.venue_id)) return false;
                    seen.add(s.venue_id);
                    return true;
                });
                if (candidates.length) {
                    const { data: liveSubs } = await db
                        .from('commander_subscriptions')
                        .select('venue_id, tier')
                        .in('venue_id', candidates.map(c => c.venue_id))
                        .in('status', ['active', 'trialing']);
                    const liveByVenue = new Map((liveSubs || []).map(s => [s.venue_id, s]));
                    staff_venues = candidates
                        .filter(c => liveByVenue.has(c.venue_id))
                        .map(c => ({ ...c, tier: liveByVenue.get(c.venue_id)?.tier || null }));
                }
            } else if (staffRes.error) {
                console.warn('[my-commander-accounts] staff error:', staffRes.error.message);
            }

            // Club logos from venue settings (owned + staff venues, one query)
            const allVenueIds = [...ownedVenueIds, ...staff_venues.map(s => s.venue_id)];
            if (allVenueIds.length) {
                const { data: settings } = await db
                    .from('commander_venue_settings')
                    .select('venue_id, club_logo_url')
                    .in('venue_id', allVenueIds);
                const logoByVenue = new Map((settings || []).map(s => [s.venue_id, s.club_logo_url]));
                for (const c of clubs) c.logo_url = logoByVenue.get(c.venue_id) || null;
                for (const s of staff_venues) s.logo_url = logoByVenue.get(s.venue_id) || null;
            }

            // Home groups: owned + administered, deduped by group id
            const groupsById = new Map();
            for (const g of (ownedGroupsRes.error ? [] : ownedGroupsRes.data || [])) {
                groupsById.set(g.id, { ...g, role: 'owner' });
            }
            if (!memberGroupsRes.error) {
                for (const m of memberGroupsRes.data || []) {
                    if (m.group && !groupsById.has(m.group.id)) {
                        groupsById.set(m.group.id, { ...m.group, role: m.role });
                    }
                }
            }
            const home_groups = Array.from(groupsById.values())
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            return res.status(200).json({ clubs, staff_venues, home_groups });
        }

        // ── POST - switch active venue ──────────────────────────────────
        const venueId = req.body?.venue_id;
        if (venueId === undefined || venueId === null || venueId === '') {
            return res.status(400).json({ error: 'venue_id required' });
        }

        // Path 1: OWNER of the venue's subscription
        const { data: ownSubs, error: ownErr } = await db
            .from('commander_subscriptions')
            .select('*, venue:poker_venues(*)')
            .eq('owner_id', user.id)
            .eq('venue_id', venueId)
            .in('status', ['active', 'trialing'])
            .order('created_at', { ascending: false })
            .limit(1);

        if (ownErr) {
            console.warn('[my-commander-accounts] switch error:', ownErr.message);
            return res.status(500).json({ error: 'Failed to switch venue' });
        }

        if (ownSubs?.length) {
            const subscription = ownSubs[0];
            const staff_session = signStaffSession({
                user_id: user.id,
                venue_id: subscription.venue_id,
                role: 'owner',
            });
            // Audit trail: venue-context switches mint new sessions, so they
            // are logged like logins (same category the PIN verifier uses)
            try {
                await logAction(AuditActions.AUTH_LOGIN, {
                    venueId: subscription.venue_id,
                    userId: user.id,
                    targetType: 'poker_venue',
                    targetId: subscription.venue_id,
                    targetName: subscription.venue?.name || null,
                    // logAudit's RPC has no target_name param - carry it in metadata
                    metadata: { via: 'club_switcher', role: 'owner', venue_name: subscription.venue?.name || null },
                    req,
                });
            } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
            return res.status(200).json({
                subscription,
                staff_session,
                role: 'owner',
                permissions: OWNER_PERMISSIONS,
            });
        }

        // Path 2: ACTIVE STAFF at the venue - grant exactly what PIN login
        // would grant that staff member (their role + merged permissions).
        const { data: staffRow, error: staffErr } = await db
            .from('commander_staff')
            .select('id, venue_id, role, permissions, display_name, is_active, profiles ( id, display_name, avatar_url )')
            .eq('venue_id', venueId)
            .or(`linked_user_id.eq.${user.id},user_id.eq.${user.id}`)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();

        if (staffErr) {
            console.warn('[my-commander-accounts] staff switch error:', staffErr.message);
            return res.status(500).json({ error: 'Failed to switch venue' });
        }
        if (!staffRow) {
            return res.status(403).json({ error: 'You do not have access to this venue' });
        }

        // The venue must have a live subscription for Commander to operate
        const { data: venueSubs, error: vsErr } = await db
            .from('commander_subscriptions')
            .select('*, venue:poker_venues(*)')
            .eq('venue_id', venueId)
            .in('status', ['active', 'trialing'])
            .order('created_at', { ascending: false })
            .limit(1);

        if (vsErr || !venueSubs?.length) {
            return res.status(403).json({ error: 'This venue does not have an active Commander subscription' });
        }

        const subscription = venueSubs[0];
        const name = staffRow.profiles?.display_name || staffRow.display_name ||
            (staffRow.role.charAt(0).toUpperCase() + staffRow.role.slice(1));
        const permissions = { ...(DEFAULT_PERMISSIONS[staffRow.role] || {}), ...(staffRow.permissions || {}) };
        const staff_session = signStaffSession({
            id: staffRow.id,
            user_id: user.id,
            venue_id: staffRow.venue_id,
            role: staffRow.role,
            display_name: name,
        });

        try {
            await logAction(AuditActions.AUTH_LOGIN, {
                venueId: staffRow.venue_id,
                userId: user.id,
                staffId: staffRow.id,
                targetType: 'poker_venue',
                targetId: staffRow.venue_id,
                targetName: subscription.venue?.name || null,
                // logAudit's RPC has no target_name param - carry it in metadata
                metadata: { via: 'club_switcher', role: staffRow.role, venue_name: subscription.venue?.name || null },
                req,
            });
        } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

        return res.status(200).json({
            subscription,
            staff_session,
            role: staffRow.role,
            permissions,
        });
    } catch (err) {
        try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
        console.warn('[API Error] my-commander-accounts:', err);
        if (!res.headersSent) return res.status(500).json({ error: 'Internal server error' });
    }
}
