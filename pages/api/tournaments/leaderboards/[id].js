/**
 * Tournament Leaderboard Detail API
 * GET /api/commander/tournaments/leaderboards/[id] - Get full leaderboard with standings
 * PUT /api/commander/tournaments/leaderboards/[id] - Update leaderboard
 * DELETE /api/commander/tournaments/leaderboards/[id] - Deactivate leaderboard
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else if (!applyRateLimit(req, res, LIMITS.read)) return;

      // 2026-08-20 fix: this was guardWriteStaff, which returns `true` on GET
      // without verifying anything, so a season's full standings (every player
      // name and point total) were readable by anyone holding the uuid.
      const staff = await guardStaff(req, res); if (!staff) return;
      const { id } = req.query;

      if (req.method === 'GET') return getLeaderboard(req, res, id, staff);
      if (req.method === 'PUT') return updateLeaderboard(req, res, id, staff);
      if (req.method === 'DELETE') return deactivateLeaderboard(req, res, id, staff);

      res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/** A staff session may only touch its own venue's seasons. */
function wrongVenue(res, staff, lb) {
    if (staff?.venue_id != null && lb?.venue_id != null &&
        Number(staff.venue_id) !== Number(lb.venue_id)) {
        res.status(403).json({ success: false, error: { code: 'WRONG_VENUE', message: 'Leaderboard Belongs To A Different Venue' } });
        return true;
    }
    return false;
}

async function loadBoard(id) {
    const { data, error } = await getSupabase()
        .from('commander_tournament_leaderboards')
        .select('*')
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function getLeaderboard(req, res, id, staff) {
    try {
        const lb = await loadBoard(id);
        if (!lb) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leaderboard Not Found' } });
        if (wrongVenue(res, staff, lb)) return;

        // Get all points for this leaderboard. commander_tournament_points has no
        // FK to commander_tournaments, so tournament name/date are fetched separately
        // (a PostgREST embed here errors PGRST200).
        const { data: points } = await getSupabase()
            .from('commander_tournament_points')
            .select('*')
            .eq('leaderboard_id', id)
            .order('created_at', { ascending: false });

        // Build tournament_id -> { name, scheduled_start } map for enrichment
        const tournamentIds = [...new Set((points || []).map(p => p.tournament_id).filter(Boolean))];
        const tournamentMap = {};
        if (tournamentIds.length > 0) {
            const { data: tournaments } = await getSupabase()
                .from('commander_tournaments')
                .select('id, name, scheduled_start')
                .in('id', tournamentIds);
            (tournaments || []).forEach(t => { tournamentMap[t.id] = t; });
        }

        // Aggregate standings
        const playerMap = {};
        (points || []).forEach(p => {
            const key = p.player_id || p.player_name;
            if (!playerMap[key]) {
                playerMap[key] = {
                    player_id: p.player_id,
                    player_name: p.player_name,
                    total_points: 0,
                    events_played: 0,
                    best_finish: null,
                    results: []
                };
            }
            const totalPts = (p.points || 0) + (p.entry_points || 0);
            playerMap[key].total_points += totalPts;
            playerMap[key].events_played += 1;
            if (p.finish_position && (!playerMap[key].best_finish || p.finish_position < playerMap[key].best_finish)) {
                playerMap[key].best_finish = p.finish_position;
            }
            playerMap[key].results.push({
                tournament_name: tournamentMap[p.tournament_id]?.name,
                tournament_date: tournamentMap[p.tournament_id]?.scheduled_start,
                finish_position: p.finish_position,
                points: totalPts
            });
        });

        const standings = Object.values(playerMap || {})
            .sort((a, b) => b.total_points - a.total_points)
            .map((player, index) => ({ ...player, rank: index + 1 }));

        return res.status(200).json({ success: true, data: { leaderboard: lb, standings } });
    } catch (error) {
        console.warn('Get leaderboard error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}

async function updateLeaderboard(req, res, id, staff) {
    try {
        const existing = await loadBoard(id);
        if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leaderboard Not Found' } });
        if (wrongVenue(res, staff, existing)) return;

        const updates = {};
        const allowed = ['name', 'season_start', 'season_end', 'point_for_entry', 'point_structure', 'is_active'];
        allowed.forEach(key => {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        });

        if (Array.isArray(updates.point_structure)) {
            updates.point_structure = updates.point_structure
                .map(slot => ({
                    position: Math.trunc(Number(slot?.position ?? slot?.place)),
                    points: Number(slot?.points ?? 0)
                }))
                .filter(slot => Number.isFinite(slot.position) && slot.position > 0 && Number.isFinite(slot.points) && slot.points >= 0)
                .sort((a, b) => a.position - b.position);
        }

        // Activating a season deactivates the venue's other active seasons, so
        // the awardTournamentPoints venue fallback stays unambiguous.
        if (updates.is_active === true) {
            await getSupabase()
                .from('commander_tournament_leaderboards')
                .update({ is_active: false })
                .eq('venue_id', existing.venue_id)
                .eq('is_active', true)
                .neq('id', id);
        }

        const { data, error } = await getSupabase()
            .from('commander_tournament_leaderboards')
            .update(updates)
            .eq('id', id)
            .select()
            .maybeSingle();

        if (error) throw error;

        return res.status(200).json({ success: true, data: { leaderboard: data } });
    } catch (error) {
        console.warn('Update leaderboard error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}

async function deactivateLeaderboard(req, res, id, staff) {
    try {
        const existing = await loadBoard(id);
        if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leaderboard Not Found' } });
        if (wrongVenue(res, staff, existing)) return;

        const { data, error } = await getSupabase()
            .from('commander_tournament_leaderboards')
            .update({ is_active: false })
            .eq('id', id)
            .select()
            .maybeSingle();

        if (error) throw error;

        return res.status(200).json({ success: true, data: { leaderboard: data } });
    } catch (error) {
        try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
        console.warn('Deactivate leaderboard error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}
