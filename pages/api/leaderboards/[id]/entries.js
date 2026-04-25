/**
 * Leaderboard Entries API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * POST /api/commander/leaderboards/[id]/entries - Add/update entry
 * POST /api/commander/leaderboards/[id]/entries/calculate - Recalculate all entries
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff, verifyStaffSession } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    // CDN cache: fresh for 30s, serve stale up to 120s
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    }

    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    const { id: leaderboardId } = req.query;

    if (!leaderboardId) {
      return res.status(400).json({ error: 'Leaderboard ID required' });
    }

    if (req.method === 'GET') {
      return listEntries(req, res, leaderboardId);
    }

    if (req.method === 'POST') {
      return addOrUpdateEntry(req, res, leaderboardId);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listEntries(req, res, leaderboardId) {
  try {
    const { data: entries, error } = await getSupabase()
      .from('commander_leaderboard_entries')
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url)
      `)
      .eq('leaderboard_id', leaderboardId)
      .order('rank', { ascending: true, nullsFirst: false })
          .limit(100);

    if (error) throw error;

    // Enrich with member data for player_name
    const playerIds = (entries || []).map(e => e.player_id).filter(Boolean);
    let memberMap = {};
    if (playerIds.length > 0) {
      const { data: members } = await getSupabase()
        .from('commander_members')
        .select('id, first_name, last_name, photo_url, membership_tier')
        .in('id', playerIds)
            .limit(100)
      (members || []).forEach(m => { memberMap[m.id] = m; });
    }

    const enriched = (entries || []).map(e => {
      const member = memberMap[e.player_id];
      const profileName = e.profiles?.display_name;
      const memberName = member ? `${member.first_name || ''} ${member.last_name || ''}`.trim() : null;
      return {
        ...e,
        player_name: memberName || profileName || 'Player',
        photo_url: member?.photo_url || e.profiles?.avatar_url,
        membership_tier: member?.membership_tier,
      };
    });

    return res.status(200).json({ entries: enriched });
  } catch (error) {
    console.warn('List entries error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function addOrUpdateEntry(req, res, leaderboardId) {
  try {
    // Staff already validated by guardWriteStaff — get venue from staff session
    const staffResult = await verifyStaffSession(req);
    if (staffResult.error) {
      return res.status(staffResult.error.status || 401).json({ error: staffResult.error.message });
    }
    const staff = staffResult.staff;

    // Get leaderboard
    const { data: leaderboard } = await getSupabase()
      .from('commander_leaderboards')
      .select('id, venue_id, leaderboard_type, status')
      .eq('id', leaderboardId)
      .maybeSingle();

    if (!leaderboard) {
      return res.status(404).json({ error: 'Leaderboard not found' });
    }

    if (leaderboard.status === 'completed') {
      return res.status(400).json({ error: 'Cannot modify completed leaderboard' });
    }

    // Verify staff is authorized for this venue
    if (staff.venue_id && staff.venue_id !== leaderboard.venue_id) {
      return res.status(403).json({ error: 'Not authorized for this venue' });
    }

    const { action = 'update' } = req.body;

    if (action === 'calculate') {
      return calculateAllEntries(req, res, leaderboard);
    }

    // Manual entry update
    const {
      player_id,
      score,
      hours_played,
      sessions_count,
      points_earned,
      qualifying_events
    } = req.body;

    if (!player_id) {
      return res.status(400).json({ error: 'Player ID required' });
    }

    const entryData = {
      leaderboard_id: leaderboardId,
      player_id,
      score: score || 0,
      hours_played: hours_played || 0,
      sessions_count: sessions_count || 0,
      points_earned: points_earned || 0,
      qualifying_events: qualifying_events || 0,
      last_updated: new Date().toISOString()
    };

    const { data: entry, error } = await getSupabase()
      .from('commander_leaderboard_entries')
      .upsert(entryData, { onConflict: 'leaderboard_id,player_id' })
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url)
      `)
      .maybeSingle();

    if (error) throw error;

    // Recalculate rankings
    await updateRankings(leaderboardId);

    return res.status(200).json({ entry });
  } catch (error) {
    console.warn('Add/update entry error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function calculateAllEntries(req, res, leaderboard) {
  try {
    // Get all player stats for this venue within the leaderboard period
    const { data: playerStats } = await getSupabase()
      .from('commander_player_stats')
      .select('*')
      .eq('venue_id', leaderboard.venue_id)
          .limit(100)

    if (!playerStats || playerStats.length === 0) {
      return res.status(200).json({
        message: 'No player stats found for this venue',
        entries_updated: 0
      });
    }

    // Get sessions within the leaderboard period
    const { data: sessions } = await getSupabase()
      .from('commander_player_sessions')
      .select('player_id, total_time_minutes, status')
      .eq('venue_id', leaderboard.venue_id)
      .eq('status', 'completed')
      .gte('check_in_time', `${leaderboard.start_date}T00:00:00`)
      .lte('check_in_time', `${leaderboard.end_date}T23:59:59`)
          .limit(100)

    // Aggregate by player
    const playerData = {};
    sessions?.forEach(session => {
      if (!session.player_id) return;
      if (!playerData[session.player_id]) {
        playerData[session.player_id] = {
          hours_played: 0,
          sessions_count: 0
        };
      }
      playerData[session.player_id].hours_played += (session.total_time_minutes || 0) / 60;
      playerData[session.player_id].sessions_count++;
    });

    // Create entries
    const entries = Object.entries(playerData || {}).map(([playerId, data]) => {
      let score = 0;
      switch (leaderboard.leaderboard_type) {
        case 'hours_played':
          score = data.hours_played;
          break;
        case 'sessions':
          score = data.sessions_count;
          break;
        default:
          score = data.hours_played;
      }

      return {
        leaderboard_id: leaderboard.id,
        player_id: playerId,
        score,
        hours_played: data.hours_played,
        sessions_count: data.sessions_count,
        last_updated: new Date().toISOString()
      };
    });

    if (entries.length > 0) {
      const { error } = await getSupabase()
        .from('commander_leaderboard_entries')
        .upsert(entries, { onConflict: 'leaderboard_id,player_id' });

      if (error) throw error;

      // Update rankings
      await updateRankings(leaderboard.id);
    }

    return res.status(200).json({
      message: 'Leaderboard entries calculated',
      entries_updated: entries.length
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Calculate entries error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateRankings(leaderboardId) {
  // Try the DB function first (single-query ranking update)
  const { error: rpcErr } = await getSupabase().rpc('update_leaderboard_rankings', { lb_id: leaderboardId });

  if (!rpcErr) return; // RPC succeeded

  // Fallback: manual ranking via JS (RPC may not exist or may have failed)
  const { data: entries } = await getSupabase()
    .from('commander_leaderboard_entries')
    .select('id, score')
    .eq('leaderboard_id', leaderboardId)
    .order('score', { ascending: false })
        .limit(100);

  if (!entries || entries.length === 0) return;

  for (let i = 0; i < entries.length; i++) {
    await getSupabase()
      .from('commander_leaderboard_entries')
      .update({ rank: i + 1 })
      .eq('id', entries[i].id);
  }
}
