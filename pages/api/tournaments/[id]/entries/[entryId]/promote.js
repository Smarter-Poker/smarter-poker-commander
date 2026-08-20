/**
 * Promote Alternate API
 * POST /api/commander/tournaments/[id]/entries/[entryId]/promote
 *
 * Seats a waiting alternate. Body may specify { table_number, seat_number };
 * otherwise the first open seat (least-occupied table) is assigned.
 * The alternate paid at sign-up, so no money moves here.
 */
import { createClient } from '../../../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../../../src/lib/commander/audit';
import { reportApiError } from '../../../../../../src/lib/sentryWrap';
import {
  sendPushNotification,
  isOneSignalConfigured
} from '../../../../../../src/lib/commander/pushNotifications';
import { claimOpenSeat } from '../../../../../../src/lib/commander/tournamentSeating';
import { sendSeatNotification } from '../../../../../../src/lib/commander/twilio';
import { seatConflictResponse, isUniqueViolation, conflictError } from '../../../../../../src/lib/commander/dbErrors';
import { notifyNextAlternates } from '../../../../../../src/lib/commander/alternateNotifications';

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

    const { id: tournamentId, entryId } = req.query;

    const [{ data: tournament }, { data: entry }] = await Promise.all([
      getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id, name, status, starting_chips, late_registration_levels, current_level')
        .eq('id', tournamentId)
        .maybeSingle(),
      getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_id, player_name, status')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle()
    ]);

    if (!tournament || !entry) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: !tournament ? 'Tournament Not Found' : 'Entry Not Found' }
      });
    }
    if (entry.status !== 'alternate') {
      return res.status(400).json({
        success: false,
        error: { code: 'NOT_ALTERNATE', message: 'Entry Is Not An Alternate' }
      });
    }
    if (!['scheduled', 'registration', 'registering', 'running', 'paused'].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Alternates Cannot Be Seated For This Tournament Status' }
      });
    }

    let tableNumber = Number(req.body?.table_number) || null;
    let seatNumber = Number(req.body?.seat_number) || null;
    let promoted = null;

    if (tableNumber && seatNumber) {
      // Explicit seat: verify it is open.
      const { data: occupant } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('table_number', tableNumber)
        .eq('seat_number', seatNumber)
        // SEAT OCCUPANCY: only a player physically in the chair blocks it.
        // 'bagged' excluded on purpose (they hold no seat).
        .in('status', ['seated', 'active'])
        .neq('id', entryId)
        .maybeSingle();
      if (occupant) {
        return res.status(409).json({
          success: false,
          error: { code: 'SEAT_OCCUPIED', message: 'That Seat Is Occupied' }
        });
      }
      // Explicit seat requested and verified free: claim it directly, but only
      // while the entry is still an alternate (guards a double-tap).
      const { data: promotedExplicit, error: explicitError } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          status: 'seated',
          table_number: tableNumber,
          seat_number: seatNumber,
          current_chips: tournament.starting_chips || 0
        })
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .eq('status', 'alternate')
        .select()
        .maybeSingle();
      // The occupancy probe above is a read. uq_commander_entries_live_seat
      // rejects the second writer with 23505, which used to bubble out of here
      // as an opaque 500 with the alternate still on the list.
      if (explicitError) {
        if (seatConflictResponse(res, explicitError, {
          tableNumber, seatNumber, playerName: entry.player_name, action: 'Alternate Seating'
        })) return;
        throw explicitError;
      }
      if (!promotedExplicit) {
        return res.status(409).json({
          success: false,
          error: { code: 'ALREADY_PROMOTED', message: 'Alternate Was Already Seated By Another Client' }
        });
      }
      promoted = promotedExplicit;
    } else {
      // Atomic: the seat is chosen and claimed in one locked statement, so two
      // simultaneous promotions can never be handed the same seat.
      const seat = await claimOpenSeat(getSupabase(), tournamentId, entryId, 'alternate');
      if (!seat) {
        return res.status(409).json({
          success: false,
          error: { code: 'NO_OPEN_SEATS', message: 'No Open Seats Available, Or The Alternate Was Just Seated. Break A Seat Free Or Add A Table.' }
        });
      }
      tableNumber = seat.table_number;
      seatNumber = seat.seat_number;
      const { data: claimed } = await getSupabase()
        .from('commander_tournament_entries')
        .select()
        .eq('id', entryId)
        .maybeSingle();
      promoted = claimed;
    }

    if (!promoted) {
      return res.status(409).json({
        success: false,
        error: { code: 'ALREADY_PROMOTED', message: 'Alternate Was Already Seated By Another Client' }
      });
    }

    if (promoted.player_id && isOneSignalConfigured()) {
      sendPushNotification({
        externalUserIds: [promoted.player_id],
        title: 'Your Seat Is Ready',
        message: `You Are In! Table ${tableNumber}, Seat ${seatNumber}, ${tournament.name}.`,
        url: `/hub/commander/tournament/${tournamentId}/my-status`,
        data: { type: 'alternate_seated', tournament_id: tournamentId }
      }).catch(err => console.warn('[promote.js] Push failed:', err.message));
    }

    // The queue just moved up by one. Everyone behind this player is now in a
    // different position and nobody would otherwise be told. Fire and forget:
    // a push failure must never fail a seating that has already happened.
    notifyNextAlternates(getSupabase(), tournament);

    await logAction({ action: 'promote_alternate', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: entryId,
      targetType: 'commander_tournament_entries',
      targetName: entry.player_name || 'Player',
      metadata: { tournament_id: tournamentId, table_number: tableNumber, seat_number: seatNumber },
      req
    });


    // SMS notification when the player has a phone number on the entry.
    // 2026-08-20 fix: the first version of this block called
    // sendSeatNotification without importing it, which threw a ReferenceError
    // and 500'd every promotion for a player with a phone. Import added, real
    // venue name fetched, and the send made fire-and-forget so a Twilio
    // outage can never fail the seating itself.
    if (promoted.player_phone) {
      (async () => {
        // 2026-08-20 audit fix: this read `venues`, whose id is a UUID and which
        // holds zero rows. commander_tournaments.venue_id is an INTEGER FK to
        // poker_venues, so the comparison was a type error, the error was
        // discarded, and every seat-ready SMS said "Your Poker Room".
        const { data: venue } = await getSupabase()
          .from('poker_venues')
          .select('name')
          .eq('id', tournament.venue_id)
          .maybeSingle();
        await sendSeatNotification(
          promoted.player_phone,
          venue?.name || 'Your Poker Room',
          `${tournament.name} (Table ${tableNumber}, Seat ${seatNumber})`,
          { timeout: 5 }
        );
      })().catch(err => console.warn('[promote.js] SMS notification failed:', err?.message || err));
    }


    return res.status(200).json({
      success: true,
      data: {
        entry: promoted,
        message: `Alternate Seated At Table ${tableNumber}, Seat ${seatNumber}.`
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[promote.js] Error:', err);
    if (!res.headersSent) {
      // A unique violation thrown from anywhere in this handler is a seat
      // collision, not a server fault. Never report it as a 500.
      if (isUniqueViolation(err)) {
        return res.status(409).json({ success: false, error: conflictError(err, { action: 'Alternate Seating' }) });
      }
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed To Seat Alternate' }
      });
    }
  }
}
