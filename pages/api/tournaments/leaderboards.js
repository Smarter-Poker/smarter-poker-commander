/**
 * Tournament Season Leaderboards API
 * GET  /api/commander/tournaments/leaderboards - List seasons for the venue
 * POST /api/commander/tournaments/leaderboards - Create a season
 *
 * These are the SEASON POINTS boards (commander_tournament_leaderboards:
 * season_start, season_end, point_for_entry, point_structure, is_active), not
 * the TV display boards in commander_leaderboards. Points earned per finish
 * land in commander_tournament_points and are aggregated here.
 *
 * 2026-08-20 fixes:
 *  - guardWriteStaff returns `true` on GET without verifying anything, so this
 *    listing (venue seasons plus every player name and point total) was public
 *    to anyone who could guess a venue_id. Reads now require a staff session
 *    and the venue comes from that session.
 *  - Creating an active season now deactivates the venue's other active
 *    seasons. awardTournamentPoints falls back to "the venue's active
 *    leaderboard" when a tournament has no leaderboard_id, and that fallback is
 *    only deterministic when exactly one is active.
 *  - point_structure is validated instead of being written through unchecked.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

const DEFAULT_POINT_STRUCTURE = [
    { position: 1, points: 100 },
    { position: 2, points: 75 },
    { position: 3, points: 60 },
    { position: 4, points: 50 },
    { position: 5, points: 40 },
    { position: 6, points: 35 },
    { position: 7, points: 30 },
    { position: 8, points: 25 },
    { position: 9, points: 20 },
    { position: 10, points: 15 }
];

// Auth: STAFF - a verified staff session is required for both read and write.
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else if (!applyRateLimit(req, res, LIMITS.read)) return;

    const staff = await guardStaff(req, res);
    if (!staff) return;

    if (req.method === 'GET') return listLeaderboards(req, res, staff);
    if (req.method === 'POST') return createLeaderboard(req, res, staff);

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

/** Venue always resolves from the verified session, never from the query. */
function resolveVenueId(req, staff) {
    const sessionVenue = Number(staff?.venue_id);
    if (Number.isFinite(sessionVenue) && sessionVenue > 0) return sessionVenue;
    const requested = Number(req.query?.venue_id ?? req.body?.venue_id);
    return Number.isFinite(requested) && requested > 0 ? requested : null;
}

/**
 * Normalize a point_structure payload to [{ position, points }] sorted by
 * position, dropping anything that is not a usable pair. Returns null when the
 * caller sent something that is not an array at all.
 */
function normalizePointStructure(raw) {
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw)) return null;
    const cleaned = raw
        .map(slot => ({
            position: Math.trunc(Number(slot?.position ?? slot?.place)),
            points: Number(slot?.points ?? slot?.point ?? 0)
        }))
        .filter(slot => Number.isFinite(slot.position) && slot.position > 0 && Number.isFinite(slot.points) && slot.points >= 0)
        .sort((a, b) => a.position - b.position);
    return cleaned;
}

async function listLeaderboards(req, res, staff) {
    try {
        const venueId = resolveVenueId(req, staff);
        if (!venueId) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Venue Could Not Be Resolved For This Session' } });
        }
        // This compares a QUERY PARAM rather than a row, so denyCrossVenue does
        // not apply - but the same fail-open leg did: `staff.venue_id &&` let a
        // session with a null or 0 venue read any venue's seasons. The session
        // layer guarantees a real venue_id, so requiring one here costs
        // nothing and removes the bypass.
        if (Number(req.query.venue_id) && String(req.query.venue_id) !== String(staff.venue_id)) {
            return res.status(403).json({ success: false, error: { code: 'WRONG_VENUE', message: 'Leaderboard Belongs To A Different Venue' } });
        }

        let query = getSupabase()
            .from('commander_tournament_leaderboards')
            .select('*')
            .eq('venue_id', venueId)
            .order('season_start', { ascending: false })
            .limit(100);

        if (req.query.active_only === 'true') query = query.eq('is_active', true);

        const { data, error } = await query;
        if (error) throw error;

        const boards = data || [];
        if (boards.length === 0) {
            return res.status(200).json({ success: true, data: { leaderboards: [] } });
        }

        // One query for every board's points instead of one per board.
        const { data: allPoints } = await getSupabase()
            .from('commander_tournament_points')
            .select('leaderboard_id, player_id, player_name, points, entry_points, finish_position')
            .in('leaderboard_id', boards.map(b => b.id))
            .limit(5000);

        const byBoard = {};
        (allPoints || []).forEach(p => {
            if (!byBoard[p.leaderboard_id]) byBoard[p.leaderboard_id] = [];
            byBoard[p.leaderboard_id].push(p);
        });

        const leaderboards = boards.map(lb => ({
            ...lb,
            standings: aggregateStandings(byBoard[lb.id] || [])
        }));

        return res.status(200).json({ success: true, data: { leaderboards } });
    } catch (error) {
        console.warn('List leaderboards error:', error);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Load Leaderboards' } });
    }
}

/** Aggregate raw commander_tournament_points rows into ranked standings. */
export function aggregateStandings(points) {
    const playerMap = {};
    (points || []).forEach(p => {
        const key = p.player_id || p.player_name;
        if (!key) return;
        if (!playerMap[key]) {
            playerMap[key] = {
                player_id: p.player_id || null,
                player_name: p.player_name || null,
                total_points: 0,
                events_played: 0,
                best_finish: null
            };
        }
        playerMap[key].total_points += (p.points || 0) + (p.entry_points || 0);
        playerMap[key].events_played += 1;
        if (p.finish_position && (!playerMap[key].best_finish || p.finish_position < playerMap[key].best_finish)) {
            playerMap[key].best_finish = p.finish_position;
        }
    });

    return Object.values(playerMap)
        .sort((a, b) => (b.total_points - a.total_points) || (a.events_played - b.events_played))
        .map((player, index) => ({ ...player, rank: index + 1 }));
}

async function createLeaderboard(req, res, staff) {
    try {
        const venueId = resolveVenueId(req, staff);
        if (!venueId) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Venue Could Not Be Resolved For This Session' } });
        }

        const { name, season_start, season_end, point_for_entry, point_structure, is_active } = req.body || {};

        if (!name || !String(name).trim()) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Season Name Is Required' } });
        }
        if (!season_start || !season_end) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Season Start And Season End Are Required' } });
        }
        if (new Date(season_end) < new Date(season_start)) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Season End Must Not Be Before Season Start' } });
        }

        const structure = normalizePointStructure(point_structure);
        if (point_structure !== undefined && structure === null) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'point_structure Must Be An Array Of { position, points }' } });
        }

        const entryPoints = Number(point_for_entry);
        const active = is_active !== false;

        // Exactly one active season per venue keeps the awardTournamentPoints
        // fallback ("the venue's active leaderboard") unambiguous.
        if (active) {
            await getSupabase()
                .from('commander_tournament_leaderboards')
                .update({ is_active: false })
                .eq('venue_id', venueId)
                .eq('is_active', true);
        }

        const { data, error } = await getSupabase()
            .from('commander_tournament_leaderboards')
            .insert({
                venue_id: venueId,
                name: String(name).trim().slice(0, 120),
                season_start,
                season_end,
                point_for_entry: Number.isFinite(entryPoints) && entryPoints >= 0 ? Math.trunc(entryPoints) : 1,
                point_structure: (structure && structure.length > 0) ? structure : DEFAULT_POINT_STRUCTURE,
                is_active: active
            })
            .select()
            .maybeSingle();

        if (error) throw error;

        return res.status(201).json({ success: true, data: { leaderboard: data } });
    } catch (error) {
        try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
        console.warn('Create leaderboard error:', error);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Create The Leaderboard' } });
    }
}
