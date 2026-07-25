/**
 * Tournament CRUD API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 3
 * GET /api/commander/tournaments - List tournaments
 * POST /api/commander/tournaments - Create tournament
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { captureException } from '../../../src/lib/commander/errorMonitoring';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
import { logAction } from '../../../src/lib/commander/audit';
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
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method === 'GET') {
      return listTournaments(req, res);
    }

    if (req.method === 'POST') {
      // _g is the staff object for writes, true for reads
      return createTournament(req, res, _g);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listTournaments(req, res) {
  try {
    const { venue_id, status, from_date, to_date, limit: rawLimit = '50' } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 500);

    // 2026-07-25 audit fix: the player hub needs a cross-venue list — when
    // venue_id is absent, return upcoming/active tournaments across venues
    // (public fields only) instead of a 400.
    if (!venue_id) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await getSupabase()
        .from('commander_tournaments')
        .select(`
          id, venue_id, name, tournament_type, buyin_amount, guaranteed_pool,
          scheduled_start, status, current_entries, max_entries,
          poker_venues (id, name, city, state)
        `)
        .in('status', ['scheduled', 'registering', 'running'])
        .gte('scheduled_start', since)
        .order('scheduled_start', { ascending: true })
        .limit(50);

      if (error) throw error;

      return res.status(200).json({ success: true, data: { tournaments: data } });
    }

    let query = getSupabase()
      .from('commander_tournaments')
      .select(`
        *,
        poker_venues (id, name, city, state)
      `)
      .eq('venue_id', venue_id)
      .order('scheduled_start', { ascending: true })
      .limit(limit);

    if (status && typeof status === 'string') {
      // Support comma-separated compound filters like 'upcoming,active'
      const statusParts = status.split(',').map(s => s.trim());

      // Map shorthand labels to actual DB status arrays
      const resolveStatuses = (label) => {
        if (label === 'upcoming') return ['scheduled', 'registering'];
        if (label === 'active') return ['running', 'paused', 'final_table'];
        return [label]; // raw status value
      };

      if (status === 'current_future') {
        query = query.not('status', 'in', '("completed","cancelled")');
      } else {
        const allStatuses = [...new Set(statusParts.flatMap(resolveStatuses))];
        query = query.in('status', allStatuses);
      }
    }

    if (from_date) {
      query = query.gte('scheduled_start', from_date);
    }

    if (to_date) {
      query = query.lte('scheduled_start', to_date);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.status(200).json({ success: true, data: { tournaments: data } });
  } catch (error) {
    captureException(error, { action: 'list_tournaments', endpoint: '/api/commander/tournaments' });
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}

async function createTournament(req, res, staff) {
  try {
    // staff is already authenticated by guardWriteStaff middleware
    if (!staff || staff === true) {
      return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' } });
    }

    const {
      venue_id,
      name,
      description,
      tournament_type,
      buyin_amount,
      buyin_fee,
      starting_chips,
      scheduled_start,
      registration_opens,
      late_registration_levels,
      min_entries,
      max_entries,
      guaranteed_pool,
      blind_structure,
      break_schedule,
      payout_structure,
      allows_rebuys,
      rebuy_amount,
      rebuy_chips,
      max_rebuys,
      rebuy_end_level,
      allows_addon,
      addon_amount,
      addon_chips,
      addon_at_break,
      bounty_amount,
      broadcast_to_smarter,
      series_id,
      settings
    } = req.body;

    if (!venue_id || !name || !tournament_type || !buyin_amount || !starting_chips || !scheduled_start) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Required fields: venue_id, name, tournament_type, buyin_amount, starting_chips, scheduled_start' }
      });
    }

    // Verify staff belongs to this venue
    if (staff.venue_id !== undefined && String(staff.venue_id) !== String(venue_id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not staff at this venue' } });
    }

    const { data: tournament, error } = await getSupabase()
      .from('commander_tournaments')
      .insert({
        venue_id: venue_id,
        name,
        description,
        tournament_type,
        buyin_amount,
        buyin_fee: buyin_fee || 0,
        starting_chips,
        scheduled_start,
        registration_opens,
        late_registration_levels: late_registration_levels || 6,
        min_entries: min_entries || 2,
        max_entries,
        guaranteed_pool,
        blind_structure: blind_structure || [],
        break_schedule: break_schedule || [],
        payout_structure: payout_structure || [],
        allows_rebuys: allows_rebuys || false,
        rebuy_amount,
        rebuy_chips,
        max_rebuys,
        rebuy_end_level,
        allows_addon: allows_addon || false,
        addon_amount,
        addon_chips,
        addon_at_break,
        bounty_amount,
        broadcast_to_smarter: broadcast_to_smarter !== false,
        series_id,
        settings: settings || {},
        created_by: staff.role === 'owner' ? null : staff.id
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    // Audit log
    await logAction({ action: 'create_tournament', category: 'tournament' }, {
      venueId: venue_id,
      staffId: staff.id,
      targetId: tournament.id,
      targetType: 'commander_tournaments',
      targetName: name,
      req
    });

    return res.status(201).json({ success: true, data: { tournament } });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    captureException(error, { action: 'create_tournament', endpoint: '/api/commander/tournaments', venue_id: req.body?.venue_id });
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}
