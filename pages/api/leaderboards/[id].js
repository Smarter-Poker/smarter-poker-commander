/**
 * Single Leaderboard API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/leaderboards/[id] - Get leaderboard with entries
 * PUT /api/commander/leaderboards/[id] - Update leaderboard
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff, verifyStaffSession } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    // 2026-08-20 audit fix: staff-only response - not shareable at the edge.
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'private, max-age=30');
    }

    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // 2026-08-20 audit fix: was guardWriteStaff, which returns `true` for GET
    // without verifying anything - any leaderboard id was readable.
    const _g = await guardStaff(req, res); if (!_g) return;

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Leaderboard ID required' });
    }

    if (req.method === 'GET') {
      return getLeaderboard(req, res, id, _g);
    }

    if (req.method === 'PUT') {
      return updateLeaderboard(req, res, id);
    }

    res.setHeader('Allow', ['GET', 'PUT']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getLeaderboard(req, res, id, staff) {
  try {
    // 2026-08-20 audit fix: venue ownership on the read path (the PUT path
    // below already had one).
    if (staff && staff !== true && staff.venue_id !== undefined && staff.venue_id !== null) {
      const { data: board } = await getSupabase()
        .from('commander_leaderboards')
        .select('id, venue_id')
        .eq('id', id)
        .maybeSingle();
      if (!board) return res.status(404).json({ error: 'Leaderboard Not Found' });
      if (String(board.venue_id) !== String(staff.venue_id)) {
        return res.status(403).json({ error: 'You Are Not Staff At This Venue' });
      }
    }

    const { data: leaderboard, error } = await getSupabase()
      .from('commander_leaderboards')
      .select(`
        *,
        poker_venues:venue_id (id, name, city, state)
      `)
      .eq('id', id)
      .maybeSingle();

    if (error || !leaderboard) {
      return res.status(404).json({ error: 'Leaderboard not found' });
    }

    // Get entries with rankings
    const { data: entries } = await getSupabase()
      .from('commander_leaderboard_entries')
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url)
      `)
      .eq('leaderboard_id', id)
      .order('rank', { ascending: true, nullsFirst: false })
      .order('score', { ascending: false })
          .limit(100);

    return res.status(200).json({
      leaderboard,
      entries: entries || [],
      total_entries: entries?.length || 0
    });
  } catch (error) {
    console.warn('Get leaderboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateLeaderboard(req, res, id) {
  try {
    // Staff already validated by guardWriteStaff - get venue from staff session
    const staffResult = await verifyStaffSession(req);
    if (staffResult.error) {
      return res.status(staffResult.error.status || 401).json({ error: staffResult.error.message });
    }
    const staff = staffResult.staff;

    // Get leaderboard to check venue
    const { data: existing } = await getSupabase()
      .from('commander_leaderboards')
      .select('venue_id')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'Leaderboard not found' });
    }

    // Verify staff is authorized for this venue
    if (staff.venue_id && staff.venue_id !== existing.venue_id) {
      return res.status(403).json({ error: 'Not authorized for this venue' });
    }

    const updates = {};
    const allowedFields = [
      'name', 'description', 'period_type', 'start_date', 'end_date',
      'prizes', 'min_hours', 'min_sessions', 'eligible_games',
      'rules_description', 'status', 'settings'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (Object.keys(updates || {}).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const { data: leaderboard, error } = await getSupabase()
      .from('commander_leaderboards')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ leaderboard });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Update leaderboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
