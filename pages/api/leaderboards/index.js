/**
 * Leaderboards API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/leaderboards - List leaderboards
 * POST /api/commander/leaderboards - Create leaderboard
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff, verifyStaffSession } from '../../../src/lib/commander/auth';
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

    if (req.method === 'GET') {
      return listLeaderboards(req, res);
    }

    if (req.method === 'POST') {
      return createLeaderboard(req, res);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listLeaderboards(req, res) {
  try {
    const { venue_id, status = 'active', limit = 20 } = req.query;

    let query = getSupabase()
      .from('commander_leaderboards')
      .select(`
        *,
        poker_venues:venue_id (id, name)
      `)
      .order('start_date', { ascending: false })
      .limit(Math.min(parseInt(limit) || 50, 500));

    if (venue_id) {
      query = query.eq('venue_id', venue_id);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.status(200).json({ leaderboards: data || [] });
  } catch (error) {
    console.warn('List leaderboards error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createLeaderboard(req, res) {
  try {
    // Staff already validated by guardWriteStaff — get venue from staff session
    const staffResult = await verifyStaffSession(req);
    if (staffResult.error) {
      return res.status(staffResult.error.status || 401).json({ error: staffResult.error.message });
    }
    const staff = staffResult.staff;

    const { venue_id } = req.body;

    if (!venue_id) {
      return res.status(400).json({ error: 'Venue ID required' });
    }

    // Verify staff is authorized for this venue
    if (staff.venue_id && staff.venue_id !== parseInt(venue_id)) {
      return res.status(403).json({ error: 'Not authorized for this venue' });
    }

    const {
      name,
      description,
      leaderboard_type,
      period_type = 'monthly',
      start_date,
      end_date,
      prizes = [],
      min_hours,
      min_sessions,
      eligible_games,
      rules_description,
      status = 'upcoming',
      settings = {}
    } = req.body;

    if (!name || !leaderboard_type || !start_date || !end_date) {
      return res.status(400).json({ error: 'Name, type, start date, and end date are required' });
    }

    const { data: leaderboard, error } = await getSupabase()
      .from('commander_leaderboards')
      .insert({
        venue_id: venue_id,
        name,
        description,
        leaderboard_type,
        period_type,
        start_date,
        end_date,
        prizes,
        min_hours,
        min_sessions,
        eligible_games,
        rules_description,
        status,
        settings
      })
      .select(`
        *,
        poker_venues:venue_id (id, name)
      `)
      .maybeSingle();

    if (error) throw error;

    if (!leaderboard) return res.status(500).json({ error: 'Failed to create leaderboard' });

    return res.status(201).json({ leaderboard });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Create leaderboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
