/**
 * Undo Elimination (Restore Entry) API
 * POST /api/commander/tournaments/[id]/entries/[entryId]/restore
 *
 * Floor staff safety valve: a mistaken bust-out is reversed in one tap.
 * - Entry returns to 'active' with finish_position/eliminated_at/eliminated_by cleared.
 * - A bounty that was awarded to the eliminator is clawed back (floored at 0).
 * - Refuses to restore when a payout has already been recorded for the entry
 *   (send force: true after voiding the payout on the Payouts screen).
 * - Only allowed while the tournament is running/paused/final_table.
 */
import { createClient } from '../../../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../../../src/lib/commander/audit';
import { reportApiError } from '../../../../../../src/lib/sentryWrap';
import { claimOpenSeat } from '../../../../../../src/lib/commander/tournamentSeating';
import { isUniqueViolation, conflictError } from '../../../../../../src/lib/commander/dbErrors';
import { reverseKnockoutBounty } from '../../../../../../src/lib/commander/tournamentBounty';
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
    const force = req.body?.force === true;

    const [{ data: tournament }, { data: entry }] = await Promise.all([
      getSupabase()
        .from('commander_tournaments')
        // tournament_type/buyin_amount/settings are needed so the bounty
        // claw-back can work out what a knockout was worth in this format.
        .select('id, venue_id, name, status, tournament_type, buyin_amount, bounty_amount, settings')
        .eq('id', tournamentId)
        .maybeSingle(),
      getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle()
    ]);

    if (!tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }
    
    // Venue scope: a valid session for one room must never reach
    // another room's tournament. See src/lib/commander/venueScope.js.
    if (denyCrossVenue(res, staff, tournament)) return;
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Entry Not Found' }
      });
    }
    if (!['running', 'paused', 'final_table'].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'TOURNAMENT_NOT_ACTIVE', message: 'Restore Is Only Available While The Tournament Is Active' }
      });
    }
    if (!['eliminated', 'winner'].includes(entry.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'NOT_ELIMINATED', message: 'Entry Is Not Eliminated' }
      });
    }
    if ((entry.payout_amount || 0) > 0 && !force) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'PAYOUT_RECORDED',
          message: 'A Payout Is Recorded For This Entry. Void It On The Payouts Screen, Then Retry With Force.'
        }
      });
    }

    // Conditional update so a double-tap or concurrent restore cannot double-apply.
    const { data: restored, error: restoreError } = await getSupabase()
      .from('commander_tournament_entries')
      .update({
        status: 'active',
        finish_position: null,
        eliminated_at: null,
        eliminated_by: null,
        ...(force ? { payout_amount: null, payout_position: null, payout_status: null } : {})
      })
      .eq('id', entryId)
      .eq('tournament_id', tournamentId)
      .in('status', ['eliminated', 'winner'])
      .select()
      .maybeSingle();

    // This write CLEARS finish_position, so it cannot collide on
    // uq_commander_entries_finish_position. It can still collide on the live
    // seat index when the restored row is put back into a chair somebody else
    // has taken since the bust, so the violation is reported as a conflict
    // rather than a 500.
    if (restoreError) {
      if (isUniqueViolation(restoreError)) {
        return res.status(409).json({
          success: false,
          error: conflictError(restoreError, {
            tableNumber: entry.table_number,
            seatNumber: entry.seat_number,
            playerName: entry.player_name,
            action: 'Elimination Undo'
          })
        });
      }
      throw restoreError;
    }
    if (!restored) {
      return res.status(409).json({
        success: false,
        error: { code: 'ALREADY_RESTORED', message: 'Entry Was Already Restored By Another Client' }
      });
    }

    // eliminate.js clears table_number/seat_number on a bust, so a restored
    // player comes back with no seat and would be invisible on the floor map
    // and in table counts. Put them back in an open seat.
    let seatAssignment = null;
    if (!restored.table_number || !restored.seat_number) {
      try {
        // Atomic claim so the restored player cannot be dropped into a seat
        // another request is taking at the same moment.
        const seat = await claimOpenSeat(getSupabase(), tournamentId, entryId, 'active');
        if (seat) {
          seatAssignment = seat;
          const { data: reseated } = await getSupabase()
            .from('commander_tournament_entries')
            .select()
            .eq('id', entryId)
            .maybeSingle();
          if (reseated) {
            restored.table_number = reseated.table_number;
            restored.seat_number = reseated.seat_number;
          }
        }
      } catch (seatErr) {
        console.warn('[restore.js] Re-seat failed (entry restored without a seat):', seatErr.message);
      }
    }

    // Claw back the bounty that the eliminator collected for this bust.
    //
    // 2026-08-21, two fixes:
    //  1. This matched the eliminator on player_id, but eliminate.js writes an
    //     ENTRY id into eliminated_by (the claim RPC takes p_eliminated_by =
    //     the eliminator's entry_id and the bounty award looks it up with
    //     .eq('id', ...)). Matching on player_id therefore found nobody and
    //     NO bounty was ever clawed back on an undo. Resolved by entry id
    //     first, with a player_id fallback for any historic row.
    //  2. Only the knockout COUNT was reversed. The cash and, in a PKO, the
    //     half-head added to the eliminator's own bounty stayed with them, so
    //     an undo left money in the system that nobody had won.
    //     reverseKnockoutBounty puts all three back.
    let bountyReversed = false;
    let bountyReversal = null;
    if (entry.eliminated_by) {
      let eliminatorEntryId = null;
      const { data: byEntryId } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('id', entry.eliminated_by)
        .maybeSingle();
      if (byEntryId) {
        eliminatorEntryId = byEntryId.id;
      } else {
        const { data: byPlayerId } = await getSupabase()
          .from('commander_tournament_entries')
          .select('id')
          .eq('tournament_id', tournamentId)
          .eq('player_id', entry.eliminated_by)
          // Still-in-the-event statuses. 'bagged' included: the eliminator may
          // have bagged since taking the bounty, and their bounty still has to
          // be clawed back when the bust is undone.
          .in('status', ['seated', 'active', 'registered', 'bagged'])
          .maybeSingle();
        eliminatorEntryId = byPlayerId?.id || null;
      }

      try {
        bountyReversal = await reverseKnockoutBounty(getSupabase(), {
          tournament,
          tournamentId,
          restoredEntry: restored || entry,
          eliminatorEntryId
        });
        bountyReversed = !!bountyReversal?.reversed;
      } catch (bountyErr) {
        // The restore itself already stands; a failed claw-back is reported,
        // never allowed to undo the undo.
        console.warn('[restore.js] Bounty claw-back failed:', bountyErr?.message || bountyErr);
      }
    }

    await logAction({ action: 'restore_entry', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: entryId,
      targetType: 'commander_tournament_entries',
      targetName: entry.player_name || 'Player',
      metadata: {
        tournament_id: tournamentId,
        previous_status: entry.status,
        previous_finish_position: entry.finish_position,
        bounty_reversed: bountyReversed,
        forced: force
      },
      req
    });

    return res.status(200).json({
      success: true,
      data: {
        entry: restored,
        bounty_reversed: bountyReversed,
        bounty_reversal: bountyReversal || undefined,
        seat_assignment: seatAssignment || undefined,
        message: seatAssignment
          ? `Elimination Undone. Player Is Back In At Table ${seatAssignment.table_number}, Seat ${seatAssignment.seat_number}.`
          : 'Elimination Undone. Player Is Back In The Field. Assign A Seat Manually.'
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[restore.js] Error:', err);
    if (!res.headersSent) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ success: false, error: conflictError(err, { action: 'Elimination Undo' }) });
      }
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed To Restore Entry' }
      });
    }
  }
}
