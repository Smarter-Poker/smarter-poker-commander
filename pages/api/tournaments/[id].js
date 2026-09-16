/**
 * Single Tournament API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 3
 * GET /api/commander/tournaments/[id] - Get tournament details
 * PUT /api/commander/tournaments/[id] - Update tournament
 * DELETE /api/commander/tournaments/[id] - Cancel tournament
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff, verifyStaffSession } from '../../../src/lib/commander/auth';
import { logAction } from '../../../src/lib/commander/audit';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';
import { structureRejection, normalizeStructure } from '../../../src/lib/commander/structureValidation';
// One copy of the payload shape rules. This file and its twin each carried a
// byte-identical private version, imported by nothing and free to drift - so a
// rule tightened on create would simply not apply on update.
import { validateTournamentPayload } from '../../../src/lib/commander/tournamentPayload';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Privacy-safe public alias - "First L." from a stored full name, else "Player".
function publicAlias(name) {
  const n = (name || '').trim();
  if (!n) return 'Player';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const lastInitial = parts[parts.length - 1][0];
  return `${parts[0]} ${lastInitial.toUpperCase()}.`;
}

// Shared structure validation - rejects obviously invalid tournament payloads
// before they persist. `partial` mode only checks the fields actually provided.
// Auth: GET is PUBLIC (live clock page); writes require STAFF_WRITE.
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' } });
    }

    if (req.method === 'GET') {
      return getTournament(req, res, id);
    }

    // PATCH is how the frontend sends status changes
    if (req.method === 'PATCH' || req.method === 'PUT') {
      return updateTournament(req, res, id, _g);
    }

    if (req.method === 'DELETE') {
      return cancelTournament(req, res, id, _g);
    }

    res.setHeader('Allow', ['GET', 'PUT', 'PATCH', 'DELETE']);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

async function getTournament(req, res, id) {
  try {
    const { data: tournament, error } = await getSupabase()
      .from('commander_tournaments')
      .select(`
        *,
        poker_venues (id, name, address, city, state),
        commander_tournament_entries (
          id,
          player_id,
          player_name,
          status,
          current_chips,
          rebuy_count,
          addon_taken,
          finish_position,
          payout_amount,
          profiles (id, display_name, avatar_url)
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!tournament) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
    }

    // The live clock page is PUBLIC. Only a signed staff session for THIS venue
    // sees raw player identities; everyone else gets a sanitized payload.
    const staffCheck = await verifyStaffSession(req);
    const isVenueStaff = !!(staffCheck && staffCheck.staff &&
      String(staffCheck.staff.venue_id) === String(tournament.venue_id));

    if (isVenueStaff) {
      return res.status(200).json({ success: true, data: { tournament } });
    }

    // Sanitized public payload - strip created_by and reduce entries to a
    // privacy-safe alias with chip/finish summary (no player_id / full name).
    const publicEntries = (tournament.commander_tournament_entries || []).map(e => {
      const prof = e.profiles || {};
      return {
        id: e.id,
        alias: prof.display_name || publicAlias(e.player_name),
        avatar_url: prof.avatar_url || null,
        status: e.status,
        current_chips: e.current_chips,
        rebuy_count: e.rebuy_count,
        addon_taken: e.addon_taken,
        finish_position: e.finish_position,
        payout_amount: e.payout_amount
      };
    });

    // ALLOWLIST, not a blacklist.
    //
    // This used to be `const { created_by, commander_tournament_entries,
    // ...publicTournament } = tournament` over a `select('*')`, which shipped
    // every other column on the row to an unauthenticated caller. That
    // included:
    //   day_end_chip_counts - bag-and-tag writes { player_name, chips,
    //                         table_number, seat_number } per player, so this
    //                         was full names against exact overnight stacks;
    //   final_payouts       - negotiated deal amounts, carrying entry_id and
    //                         player_id per eliminate.js;
    //   settings            - clock_state and the room's internal config.
    //
    // A blacklist over `*` fails open by construction: every column added to
    // commander_tournaments in future would publish itself. index.js already
    // solved this with a PUBLIC_COLUMNS allowlist; this is the same field set,
    // so the two public surfaces cannot disagree.
    const PUBLIC_TOURNAMENT_FIELDS = [
      'id', 'venue_id', 'name', 'description', 'tournament_type', 'variant',
      'buyin_amount', 'buyin_fee', 'starting_chips', 'scheduled_start',
      'registration_opens', 'late_registration_levels', 'late_reg_open',
      'min_entries', 'max_entries', 'guaranteed_pool', 'actual_prizepool',
      'paying_places', 'payout_structure', 'blind_structure', 'break_schedule',
      'allows_rebuys', 'rebuy_amount', 'rebuy_chips', 'max_rebuys', 'rebuy_end_level',
      'allows_addon', 'addon_amount', 'addon_chips', 'addon_at_break', 'bounty_amount',
      'status', 'current_level', 'current_entries', 'players_remaining',
      'total_chips_in_play', 'average_stack', 'tables_remaining', 'hands_played',
      'actual_start', 'ended_at', 'series_id', 'leaderboard_id',
      'is_multi_day', 'total_days', 'current_day', 'flight_label', 'resume_time'
    ];
    const publicTournament = {};
    for (const k of PUBLIC_TOURNAMENT_FIELDS) {
      if (k in tournament) publicTournament[k] = tournament[k];
    }
    publicTournament.poker_venues = tournament.poker_venues || null;

    return res.status(200).json({
      success: true,
      data: { tournament: { ...publicTournament, entries: publicEntries } }
    });
  } catch (error) {
    console.warn('Get tournament error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

async function updateTournament(req, res, id, staff) {
  try {
    // staff is already validated by guardWriteStaff at the handler level
    if (!staff || staff === true) {
      return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Staff Authentication Required' } });
    }

    // Get tournament to verify it exists (settings is needed below so a
    // client-sent settings blob cannot clobber the live clock state)
    const { data: existing, error: fetchError } = await getSupabase()
      .from('commander_tournaments')
      .select('venue_id, status, max_entries, settings')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
    }

    // Verify staff belongs to this venue
    if (staff.venue_id !== undefined && String(staff.venue_id) !== String(existing.venue_id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' } });
    }

    // Reject obviously invalid structures before persisting. Only provided
    // fields are checked; the entries cap falls back to the stored max_entries.
    const structErr = validateTournamentPayload(
      { ...req.body, max_entries: (req.body.max_entries !== undefined ? req.body.max_entries : existing.max_entries) },
      { partial: true }
    );
    if (structErr) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: structErr } });
    }

    // Deep structure gate. Only runs when a structure is actually being sent,
    // so a status-only PATCH on an event with a legacy structure is untouched,
    // but nobody can SAVE blinds that go down, a 0-minute level, an ante above
    // the big blind, or a break on row one.
    const blindRejection = structureRejection(req.body.blind_structure);
    if (blindRejection) {
      return res.status(400).json({ success: false, error: blindRejection });
    }

    // 2026-08-20 audit fix: this spread the WHOLE request body into the UPDATE
    // and only removed four keys. The TD screen round-trips the tournament
    // object, which carries embedded relations (poker_venues,
    // commander_tournament_entries) and read-only aggregates - PostgREST rejects
    // any unknown column, so a plain "save" 500'd. Allowlist the real,
    // editable columns instead.
    const EDITABLE_COLUMNS = [
      'name', 'description', 'tournament_type', 'variant',
      'buyin_amount', 'buyin_fee', 'starting_chips',
      'scheduled_start', 'registration_opens', 'late_registration_levels', 'late_reg_open',
      'min_entries', 'max_entries', 'guaranteed_pool',
      'blind_structure', 'break_schedule', 'payout_structure', 'paying_places',
      'allows_rebuys', 'rebuy_amount', 'rebuy_chips', 'max_rebuys', 'rebuy_end_level',
      'allows_addon', 'addon_amount', 'addon_chips', 'addon_at_break',
      'bounty_amount', 'broadcast_to_smarter', 'series_id', 'leaderboard_id',
      'settings', 'status', 'current_level', 'actual_start', 'ended_at',
      'actual_prizepool', 'final_payouts',
      'is_multi_day', 'total_days', 'current_day', 'flight_label', 'resume_time',
      'day_end_chip_counts', 'parent_tournament_id', 'engine_id',
    ];

    const updates = { updated_at: new Date().toISOString() };
    for (const key of EDITABLE_COLUMNS) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    // Persist the canonical key shape. A client sending the legacy
    // { small, big } rows used to store a structure no screen could read.
    if (updates.blind_structure !== undefined) {
      updates.blind_structure = normalizeStructure(updates.blind_structure);
    }

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No Editable Fields Were Provided' } });
    }

    // Clock state lives at settings.clock_state and is written atomically by
    // the clock endpoints. A whole-settings update from this generic route
    // must never clobber the live clock, so the stored clock_state is carried
    // over into any client-sent settings blob.
    if (updates.settings !== undefined) {
      const storedClockState = (existing.settings || {}).clock_state;
      if (updates.settings && typeof updates.settings === 'object' && storedClockState !== undefined) {
        updates.settings = { ...updates.settings, clock_state: storedClockState };
      }
    }

    const { data: tournament, error } = await getSupabase()
      .from('commander_tournaments')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;

    // Audit log (guard: .maybeSingle() can return null even without error)
    await logAction({ action: 'update_tournament', category: 'tournament' }, {
      venueId: existing.venue_id,
      staffId: staff.id,
      targetId: id,
      targetType: 'commander_tournaments',
      targetName: tournament?.name || 'Tournament',
      changes: updates,
      req
    });

    return res.status(200).json({ success: true, data: { tournament } });
  } catch (error) {
    console.warn('Update tournament error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

async function cancelTournament(req, res, id, staff) {
  try {
    // staff is already validated by guardWriteStaff at the handler level
    if (!staff || staff === true) {
      return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Staff Authentication Required' } });
    }

    // Only owners/managers/dualrate can cancel
    if (!['owner', 'manager', 'dualrate'].includes(staff.role)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only Owners, Managers, And Dual Rate Staff Can Cancel Tournaments' } });
    }

    // Get tournament
    const { data: existing, error: fetchError } = await getSupabase()
      .from('commander_tournaments')
      .select('venue_id, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
    }

    // Verify staff belongs to this venue
    if (staff.venue_id !== undefined && String(staff.venue_id) !== String(existing.venue_id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' } });
    }

    if (existing.status === 'completed') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Cannot Cancel A Completed Tournament' } });
    }

    const { data: tournament, error } = await getSupabase()
      .from('commander_tournaments')
      .update({
        status: 'cancelled',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;

    // Audit log (guard: .maybeSingle() can return null even without error)
    await logAction({ action: 'cancel_tournament', category: 'tournament' }, {
      venueId: existing.venue_id,
      staffId: staff.id,
      targetId: id,
      targetType: 'commander_tournaments',
      targetName: tournament?.name || 'Tournament',
      req
    });

    return res.status(200).json({ success: true, data: { tournament, message: 'Tournament Cancelled' } });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Cancel tournament error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
