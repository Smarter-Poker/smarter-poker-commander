/**
 * Commander Venue Details API - GET/PATCH /api/commander/venues/:id
 * Get venue details or update venue settings
 * Reference: API_REFERENCE.md - Venues section
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require manager auth
    const _staff = await guardManager(req, res);
    if (!_staff) return;

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Venue ID required' }
      });
    }

    if (req.method === 'GET') {
      return handleGet(req, res, id);
    } else if (req.method === 'PATCH') {
      return handlePatch(req, res, id);
    } else {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleGet(req, res, venueId) {
  try {
    // Get venue details
    const { data: venue, error: venueError } = await getSupabase()
      .from('poker_venues')
      .select('*')
      .eq('id', venueId)
      .maybeSingle();

    if (venueError || !venue) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Venue not found' }
      });
    }

    // Get current running games
    const { data: currentGames } = await getSupabase()
      .from('commander_games')
      .select('*')
      .eq('venue_id', venueId)
      .in('status', ['waiting', 'running'])
      .order('created_at', { ascending: false })
          .limit(100)

    // Get waitlist summaries by game type/stakes
    const { data: waitlists } = await getSupabase()
      .from('commander_waitlist')
      .select('game_type, stakes, id')
      .eq('venue_id', venueId)
      .eq('status', 'waiting')

    // Group waitlists by game type and stakes
    const waitlistSummary = {};
    (waitlists || []).forEach(entry => {
      const key = `${entry.game_type}-${entry.stakes}`;
      if (!waitlistSummary[key]) {
        waitlistSummary[key] = {
          game_type: entry.game_type,
          stakes: entry.stakes,
          count: 0
        };
      }
      waitlistSummary[key].count++;
    });

    return res.status(200).json({
      success: true,
      data: {
        venue,
        currentGames: currentGames || [],
        waitlists: Object.values(waitlistSummary || {}),
        todaysTournaments: [], // Phase 3 feature
        activePromotions: []  // Phase 5 feature
      }
    });
  } catch (error) {
    console.warn('Commander venue GET error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handlePatch(req, res, venueId) {
  try {
    // Verify manager authentication
    const staffSession = req.headers['x-staff-session'];
    if (!staffSession) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' }
      });
    }

    let sessionData;
    try {
      sessionData = JSON.parse(staffSession);
    } catch {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SESSION', message: 'Invalid session format' }
      });
    }

    const { data: staff, error: staffError } = await getSupabase()
      .from('commander_staff')
      .select('id, venue_id, role, is_active')
      .eq('id', sessionData.id)
      .eq('is_active', true)
      .maybeSingle();

    if (staffError || !staff) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_STAFF', message: 'Staff member not found or inactive' }
      });
    }

    // Verify staff belongs to this venue and has manager role
    if (String(staff.venue_id) !== String(venueId)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' }
      });
    }

    if (!['owner', 'manager'].includes(staff.role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Manager role required' }
      });
    }

    const allowedFields = [
      'waitlist_settings',
      'tournament_settings',
      'auto_text_enabled',
      'staff_pin_required'
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates || {}).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' }
      });
    }

    const { data, error } = await getSupabase()
      .from('poker_venues')
      .update(updates)
      .eq('id', venueId)
      .select()
      .maybeSingle();

    if (error) {
      console.warn('Commander venue PATCH error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to update venue' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { venue: data }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Commander venue PATCH error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
