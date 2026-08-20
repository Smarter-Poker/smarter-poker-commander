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

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Venue ID required' }
      });
    }

    // GET is PUBLIC - venue details, current games, waitlist summary, settings,
    // today's tournaments and active promotions are all player-facing data
    // rendered on the public venue page. Write methods below stay manager-gated
    // (and were already rate-limited above).
    if (req.method === 'GET') {
      return handleGet(req, res, id);
    }

    // Auth guard: all non-GET methods require manager auth.
    const _staff = await guardManager(req, res);
    if (!_staff) return;

    if (req.method === 'PATCH') {
      // 2026-07-25 audit fix: pass the guardManager staff object through instead
      // of re-authenticating inside handlePatch.
      return handlePatch(req, res, id, _staff);
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

    // Public venue settings (comp rate, room open, house rules, display prefs).
    // commander_venue_settings SELECT is public.
    const { data: settings } = await getSupabase()
      .from('commander_venue_settings')
      .select('venue_id, auto_comp_rate, room_open, venue_type, show_player_names_on_display, house_rules, default_game_type, default_stakes, max_tables, hard_stop_enabled, hard_stop_time, club_logo_url')
      .eq('venue_id', venueId)
      .maybeSingle();

    // Today's + upcoming tournaments (sanitized public fields only).
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { data: todaysTournaments } = await getSupabase()
      .from('commander_tournaments')
      .select('id, name, description, tournament_type, variant, buyin_amount, buyin_fee, starting_chips, scheduled_start, registration_opens, late_registration_levels, guaranteed_pool, max_entries, current_entries, players_remaining, status')
      .eq('venue_id', venueId)
      .in('status', ['scheduled', 'registration', 'running'])
      .gte('scheduled_start', startOfToday.toISOString())
      .order('scheduled_start', { ascending: true })
      .limit(50);

    // Active promotions (sanitized public fields only).
    const { data: activePromotions } = await getSupabase()
      .from('commander_promotions')
      .select('id, name, description, promotion_type, prize_type, prize_value, prize_description, start_date, end_date, days_of_week, start_time, end_time, is_recurring, image_url, is_featured, status')
      .eq('venue_id', venueId)
      .eq('status', 'active')
      .order('is_featured', { ascending: false })
      .limit(50);

    return res.status(200).json({
      success: true,
      data: {
        venue,
        settings: settings || null,
        currentGames: currentGames || [],
        waitlists: Object.values(waitlistSummary || {}),
        todaysTournaments: todaysTournaments || [],
        activePromotions: activePromotions || []
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

async function handlePatch(req, res, venueId, staff) {
  try {
    // 2026-07-25 audit fix: staff comes from guardManager in the handler - the
    // old re-auth looked up commander_staff by sessionData.id, which is
    // undefined for owner sessions.
    if (!staff) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' }
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
