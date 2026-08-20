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
import { findOpenSeat } from '../../../../../../src/lib/commander/tournamentSeating';

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

    if (tableNumber && seatNumber) {
      // Explicit seat: verify it is open.
      const { data: occupant } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('table_number', tableNumber)
        .eq('seat_number', seatNumber)
        .in('status', ['seated', 'active'])
        .neq('id', entryId)
        .maybeSingle();
      if (occupant) {
        return res.status(409).json({
          success: false,
          error: { code: 'SEAT_OCCUPIED', message: 'That Seat Is Occupied' }
        });
      }
    } else {
      const open = await findOpenSeat(getSupabase(), tournament);
      if (!open) {
        return res.status(409).json({
          success: false,
          error: { code: 'NO_OPEN_SEATS', message: 'No Open Seats Available. Break A Seat Free Or Add A Table.' }
        });
      }
      tableNumber = open.table_number;
      seatNumber = open.seat_number;
    }

    const { data: promoted, error: promoteError } = await getSupabase()
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

    if (promoteError) throw promoteError;
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

    await logAction({ action: 'promote_alternate', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: entryId,
      targetType: 'commander_tournament_entries',
      targetName: entry.player_name || 'Player',
      metadata: { tournament_id: tournamentId, table_number: tableNumber, seat_number: seatNumber },
      req
    });


    // Upgrade to the max: Send an SMS notification if the player has a phone number
    if (promoted.player_phone) {
      try {
        const venueName = 'Your Poker Room'; // Optional enhancement: fetch venue name
        await sendSeatNotification(
          promoted.player_phone,
          venueName,
          `Tournament (Table ${tableNumber}, Seat ${seatNumber})`,
          { timeout: 5 }
        );
      } catch (err) {
        console.warn('Failed to send SMS notification', err);
      }
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed To Seat Alternate' }
      });
    }
  }
}
