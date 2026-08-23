/**
 * Tournament Addon API
 * POST /api/commander/tournaments/[id]/entries/[entryId]/addon
 * Processes an add-on for a tournament player
 * Adds chips, sets addon_taken flag (one-time only)
 */
import { createClient } from '../../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../../src/lib/apiRateLimit';
import { parseBlindStructure } from '../../../../../../src/lib/parseBlindStructure';
import { reportApiError } from '../../../../../../src/lib/sentryWrap';
import { denyCrossVenue } from '../../../../../../src/lib/commander/venueScope';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

/**
 * ADD-ON WINDOW (advisory only, added 2026-08-20)
 *
 * commander_tournaments.addon_at_break holds which break the add-on is sold at
 * (1 = the first break in the blind structure, 2 = the second, and so on;
 * the shipped templates set it to 2). Nothing checked it, so an add-on could be
 * rung up at any point in the event with no signal at all.
 *
 * This deliberately does NOT block the sale. Every room sells add-ons slightly
 * outside the exact break: the line is still moving when the clock restarts, a
 * player was in the toilet, the TD holds the window open another two minutes.
 * Hard-blocking would have the floor working around the software. Instead the
 * route returns `outside_addon_window` and a human-readable note so the TD UI
 * can warn while still taking the money.
 *
 * Returns null when there is nothing to assert: no configured break, no blind
 * structure, a structure with fewer breaks than configured, or an unreadable
 * current level. Silence beats a warning built on missing data.
 */
function checkAddonWindow(tournament) {
  const targetBreak = Number(tournament?.addon_at_break);
  if (!Number.isInteger(targetBreak) || targetBreak < 1) return null;

  const blinds = parseBlindStructure(tournament.blind_structure);
  if (!Array.isArray(blinds) || blinds.length === 0) return null;

  // Breaks share the array with playing levels, so a break's position is an
  // index, not a level number.
  const breakIndexes = [];
  blinds.forEach((row, i) => { if (row && row.is_break) breakIndexes.push(i); });

  const targetIndex = breakIndexes[targetBreak - 1];
  if (targetIndex === undefined) return null;

  const currentIndex = Number(tournament.current_level);
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return null;
  if (currentIndex === targetIndex) return null; // Inside the window.

  return {
    outside_addon_window: true,
    addon_window_note: `Add-Ons Are Scheduled For Break ${targetBreak.toLocaleString()}. ` +
      `The Clock Is On ${describeClockPosition(blinds, currentIndex)}. The Add-On Was Still Processed.`
  };
}

/** "Level 7" or "Break 2" for a row index in the blind structure. */
function describeClockPosition(blinds, index) {
  const row = blinds[index];
  let count = 0;
  for (let i = 0; i <= index && i < blinds.length; i++) {
    const isBreak = !!(blinds[i] && blinds[i].is_break);
    if (row && row.is_break ? isBreak : !isBreak) count++;
  }
  if (count === 0) count = index + 1;
  return `${row && row.is_break ? 'Break' : 'Level'} ${count.toLocaleString()}`;
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const { id: tournamentId, entryId } = req.query;
    if (!tournamentId || !entryId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID And Entry ID Required' } });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // 2026-07-25 audit fix: addon_cost/addon_level are not real columns -
      // use addon_amount; starting_chips is referenced in the fallback below.
      const { data: tournament } = await getSupabase()
        .from('commander_tournaments')
        // addon_at_break/blind_structure/current_level feed the advisory
        // window check below. They never block the sale.
        .select('id, venue_id, allows_addon, addon_amount, addon_chips, starting_chips, addon_at_break, blind_structure, current_level')
        .eq('id', tournamentId)
        .maybeSingle();
      if (!tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
      
      // Venue scope: a valid session for one room must never reach
      // another room's tournament. See src/lib/commander/venueScope.js.
      if (denyCrossVenue(res, _g, tournament)) return;


      if (!tournament.allows_addon) {
        return res.status(400).json({ success: false, error: { code: 'ADDONS_NOT_ALLOWED', message: 'Add-Ons Not Allowed In This Tournament' } });
      }

      const { data: entry } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (!entry) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entry Not Found' } });

      // Only a player in a chair can take an add-on: add-ons are sold at the
      // break, chips are pushed to the seat, and the add-on window has always
      // closed before a multi-day day ends. 'bagged' excluded on purpose.
      if (!['active', 'seated'].includes(entry.status)) {
        return res.status(400).json({ success: false, error: { code: 'PLAYER_NOT_ACTIVE', message: 'Player Must Be Active To Take Add-On' } });
      }

      if (entry.addon_taken) {
        return res.status(400).json({ success: false, error: { code: 'ADDON_ALREADY_TAKEN', message: 'Player Has Already Taken Their Add-On' } });
      }

      const addonChips = tournament.addon_chips || tournament.starting_chips || 10000;

      // 2026-07-28 audit fix: addon_taken is a one-time flag, but it was tested
      // in JS and set in a later statement. Two concurrent add-ons both read
      // addon_taken = false, both passed the check and both added chips, while
      // the vault was charged twice. current_chips had the same read-modify-write
      // race on top of that.
      //
      // commander_txn_tournament_addon moves the flag test into the UPDATE
      // predicate (... AND addon_taken = false) and adds the chips with
      // current_chips = current_chips + delta, writing the cash ledger row in
      // the same transaction. Exactly one of two racing calls can win.
      //
      // idempotency_key is optional; on a resubmission the ORIGINAL cash
      // transaction is returned with success and nothing moves again.
      const idempotencyKey = typeof req.body?.idempotency_key === 'string' && req.body.idempotency_key.trim()
        ? req.body.idempotency_key.trim().slice(0, 200)
        : null;

      const { data: result, error: uErr } = await getSupabase()
        .rpc('commander_txn_tournament_addon', {
          p_entry_id: entryId,
          p_tournament_id: tournamentId,
          p_chips: addonChips,
          p_venue_id: tournament.venue_id,
          p_amount: tournament.addon_amount || 0,
          p_player_name: entry.player_name,
          p_processed_by: _g.id || null, // staff ID from guardWriteStaff
          p_idempotency_key: idempotencyKey
        });

      if (uErr) {
        if (uErr.code === 'P0002') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entry Not Found' } });
        if (uErr.code === 'P0001') return res.status(400).json({ success: false, error: { code: 'ADDON_REJECTED', message: uErr.message || 'Add-On Rejected' } });
        console.warn('Addon RPC error:', uErr);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Process Add-On' } });
      }

      const updatedEntry = result?.entry || {};
      const newChips = updatedEntry.current_chips ?? ((entry.current_chips || 0) + addonChips);

      // Advisory only. Computed AFTER the sale so a bad structure can never
      // stop chips reaching a player who has already paid.
      let windowAdvisory = null;
      try {
        windowAdvisory = checkAddonWindow(tournament);
      } catch (windowErr) {
        console.warn('[addon.js] Add-on window check failed:', windowErr?.message || windowErr);
      }

      // Response shape unchanged, plus the optional advisory fields.
      return res.status(200).json({
        success: true,
        data: {
          entry_id: entryId,
          player_name: entry.player_name,
          chips_added: addonChips,
          total_chips: newChips,
          cost: tournament.addon_amount || 0, // 2026-07-25 audit fix: real column
          replayed: result?.replayed === true,
          ...(windowAdvisory || {})
        }
      });
    } catch (err) {
      console.warn('Addon error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
