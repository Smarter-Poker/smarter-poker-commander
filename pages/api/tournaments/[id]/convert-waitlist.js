/**
 * Waitlist To Tournament Conversion API
 * POST /api/commander/tournaments/[id]/convert-waitlist
 *
 * Takes players off the room's CASH waitlist (commander_waitlist) and
 * registers them into this tournament. This is the "the 2/5 is not going to
 * run, put them in the 7 o'clock" move every floor makes by hand, and it used
 * to mean re-typing every name into the registration screen.
 *
 * Body (one of):
 *   { waitlist_ids: ["uuid", ...] }   explicit rows
 *   { game_id: "uuid" }               every waiting row for that cash game
 * Optional:
 *   { payment_method: "cash" }        forwarded to the registration
 *
 * Registration itself is NOT reimplemented here. It calls
 * registerPlayerForTournament from the register route, so the capacity check,
 * the self-exclusion gate, spending limits, the late-registration cutoff, the
 * cash-drawer write and the auto-seat all behave identically to a normal
 * registration.
 *
 * Auth: STAFF - any floor staff at the tournament's venue.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../src/lib/commander/audit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';
import { registerPlayerForTournament } from './register';
import { denyCrossVenue } from '../../../../src/lib/commander/venueScope';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// Only a row still in the queue can be converted. 'seated', 'passed' and
// 'removed' rows have already left it.
const CONVERTIBLE_STATUSES = ['waiting', 'called'];

// commander_waitlist_status_check allows exactly:
//   waiting | called | seated | passed | removed
// There is no 'converted'. 'seated' would be a lie in the cash-game reports
// (this player was never seated in that game), so a converted row is taken off
// the list as 'removed' and the reason is written into notes, which is what
// every waitlist screen already reads.
const CONVERTED_STATUS = 'removed';

const MAX_BATCH = 50;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
      });
    }
    if (!applyRateLimit(req, res, LIMITS.write)) return;

    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { id: tournamentId } = req.query;

    const { data: tournament, error: tErr } = await getSupabase()
      .from('commander_tournaments')
      .select('id, venue_id, name, status, buyin_amount, buyin_fee')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tErr || !tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }

    // One shared check. This was one of three hand-written spellings, and
    // this one fell OPEN on a null or 0 venue_id.
    if (denyCrossVenue(res, staff, tournament)) return;

    const waitlistIds = Array.isArray(req.body?.waitlist_ids)
      ? req.body.waitlist_ids.filter(v => typeof v === 'string' && v.trim()).slice(0, MAX_BATCH)
      : null;
    const gameId = (typeof req.body?.game_id === 'string' && req.body.game_id.trim())
      ? req.body.game_id.trim()
      : null;

    if ((!waitlistIds || waitlistIds.length === 0) && !gameId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Provide waitlist_ids Or game_id To Choose Who To Convert.'
        }
      });
    }

    // Venue scoping is applied to the READ, so an id from another room can
    // never be converted even if it is guessed correctly.
    let query = getSupabase()
      .from('commander_waitlist')
      .select('id, player_id, player_name, player_phone, status, game_type, stakes, signup_method, notes, created_at, position')
      .eq('venue_id', tournament.venue_id)
      .order('position', { ascending: true });

    query = waitlistIds && waitlistIds.length > 0
      ? query.in('id', waitlistIds)
      : query.eq('game_id', gameId).in('status', CONVERTIBLE_STATUSES).limit(MAX_BATCH);

    const { data: rows, error: wErr } = await query;

    if (wErr) {
      console.error('[convert-waitlist] waitlist read failed', {
        tournamentId, code: wErr.code, message: wErr.message, details: wErr.details,
      });
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed To Read The Waitlist' }
      });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No Matching Waitlist Entries Were Found For This Venue.' }
      });
    }

    const converted = [];
    const skipped = [];
    const now = new Date().toISOString();

    // Sequential on purpose. Each registration can claim a seat and writes a
    // cash-drawer row; running them in parallel invites two conversions into
    // the same chair and interleaved money rows.
    for (const row of rows) {
      const who = row.player_name || 'Player';

      if (!CONVERTIBLE_STATUSES.includes(row.status)) {
        skipped.push({ waitlist_id: row.id, player_name: who, code: 'NOT_IN_QUEUE', message: `Already ${row.status}.` });
        continue;
      }
      if (!row.player_id) {
        skipped.push({
          waitlist_id: row.id,
          player_name: who,
          code: 'NO_LINKED_ACCOUNT',
          message: 'This Walk-In Has No Player Account. Register Them From The Add Player Screen.'
        });
        continue;
      }

      let result;
      try {
        result = await registerPlayerForTournament({
          tournamentId,
          body: {
            player_id: row.player_id,
            player_name: who,
            ...(req.body?.payment_method ? { payment_method: req.body.payment_method } : {})
          },
          staff,
          req
        });
      } catch (regErr) {
        console.error('[convert-waitlist] registration threw', {
          tournamentId, waitlist_id: row.id, message: regErr?.message,
        });
        skipped.push({ waitlist_id: row.id, player_name: who, code: 'SERVER_ERROR', message: 'Registration Failed.' });
        continue;
      }

      const ok = result.status >= 200 && result.status < 300;
      // A player already in this tournament still belongs OFF the cash list:
      // the conversion is what the floor asked for and it is already true.
      const alreadyIn = result.body?.error?.code === 'ALREADY_REGISTERED';

      if (!ok && !alreadyIn) {
        skipped.push({
          waitlist_id: row.id,
          player_name: who,
          code: result.body?.error?.code || 'REGISTRATION_FAILED',
          message: result.body?.error?.message || 'Registration Failed.'
        });
        continue;
      }

      const note = `[${now}] Converted To Tournament: ${tournament.name || 'Tournament'}${alreadyIn ? ' (Already Registered)' : ''}`;
      const { error: updErr } = await getSupabase()
        .from('commander_waitlist')
        .update({
          status: CONVERTED_STATUS,
          notes: row.notes ? `${row.notes}\n${note}` : note
        })
        .eq('id', row.id)
        // Guards a double-tap: a row another client already converted is not
        // converted twice, and the player is not charged twice.
        .in('status', CONVERTIBLE_STATUSES);

      if (updErr) {
        console.error('[convert-waitlist] waitlist update failed', {
          tournamentId, waitlist_id: row.id,
          code: updErr.code, message: updErr.message, details: updErr.details,
        });
      }

      // Non-critical: keeps the room's wait-time reporting honest about how
      // long this player waited before the conversion.
      try {
        await getSupabase().from('commander_waitlist_history').insert({
          venue_id: tournament.venue_id,
          player_id: row.player_id,
          game_type: row.game_type,
          stakes: row.stakes,
          wait_time_minutes: row.created_at
            ? Math.max(0, Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000))
            : null,
          // They were not seated in the cash game they were waiting for.
          was_seated: false,
          signup_method: row.signup_method
        });
      } catch (histErr) { console.warn('[convert-waitlist] history insert failed:', histErr?.message || histErr); }

      const entry = result.body?.data?.entry || null;
      converted.push({
        waitlist_id: row.id,
        player_id: row.player_id,
        player_name: who,
        entry_id: entry?.id || null,
        already_registered: alreadyIn || undefined,
        is_alternate: result.body?.data?.is_alternate || undefined,
        table_number: result.body?.data?.seat_assignment?.table_number ?? entry?.table_number ?? null,
        seat_number: result.body?.data?.seat_assignment?.seat_number ?? entry?.seat_number ?? null
      });
    }

    await logAction({ action: 'convert_waitlist_to_tournament', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: tournamentId,
      targetType: 'commander_tournaments',
      targetName: tournament.name || 'Tournament',
      metadata: {
        tournament_id: tournamentId,
        requested: rows.length,
        converted: converted.length,
        skipped: skipped.length,
        waitlist_ids: converted.map(c => c.waitlist_id)
      },
      req
    });

    const messageParts = [
      `${converted.length.toLocaleString()} Player${converted.length === 1 ? '' : 's'} Registered`
    ];
    if (skipped.length > 0) {
      messageParts.push(`${skipped.length.toLocaleString()} Skipped`);
    }

    return res.status(200).json({
      success: true,
      data: {
        converted,
        skipped,
        message: `${messageParts.join(', ')}.`
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[convert-waitlist] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed To Convert Waitlist Entries' }
      });
    }
  }
}
