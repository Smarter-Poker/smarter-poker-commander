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
function validateTournamentPayload(body, { partial = false } = {}) {
    const { blind_structure, payout_structure, paying_places, max_entries } = body || {};

    if (blind_structure !== undefined) {
        let bs = blind_structure;
        if (typeof bs === 'string') { try { bs = JSON.parse(bs); } catch { bs = null; } }
        if (!Array.isArray(bs) || bs.length === 0) return 'blind_structure Must Be A Non-Empty Array Of Levels';
        if (!bs.some(l => l && !l.is_break)) return 'blind_structure Must Contain At Least One Playing Level';
    } else if (!partial) {
        return 'blind_structure Is Required And Must Be A Non-Empty Array Of Levels';
    }

    if (Array.isArray(payout_structure) && payout_structure.length > 0) {
        const sum = payout_structure.reduce((s, p) => s + (Number(p && (p.pct != null ? p.pct : p.percentage)) || 0), 0);
        if (Math.abs(sum - 100) > 0.5) return `payout_structure Percentages Must Total ~100% (Got ${sum.toFixed(2)}%)`;
    }

    const cap = (max_entries !== undefined && max_entries !== null && max_entries !== '') ? parseInt(max_entries) : null;
    if (cap && Number.isFinite(cap) && paying_places != null && parseInt(paying_places) > cap) {
        return `paying_places (${paying_places}) Cannot Exceed max_entries (${cap})`;
    }

    return null;
}

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
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
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

    const { created_by, commander_tournament_entries, ...publicTournament } = tournament;

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

    const updates = { ...req.body, updated_at: new Date().toISOString() };

    // Remove fields that shouldn't be updated directly
    delete updates.id;
    delete updates.venue_id;
    delete updates.created_by;
    delete updates.created_at;

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
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Cancel tournament error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
