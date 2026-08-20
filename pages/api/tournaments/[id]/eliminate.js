/**
 * Tournament Elimination API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 3
 * POST /api/commander/tournaments/[id]/eliminate - Eliminate a player
 * 
 * Push Notifications: Fires on elimination (ITM/bust/winner)
 * Auto-Stories: Creates tournament stories for ITM and winner milestones
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import {
  sendPushNotification,
  isOneSignalConfigured
} from '../../../../src/lib/commander/pushNotifications';
import { checkAndExecuteAutoBreak } from '../../../../src/lib/commander/tournamentAutoBreak';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { logAction } from '../../../../src/lib/commander/audit';
import { promoteNextAlternate } from '../../../../src/lib/commander/tournamentSeating';
import { notifyNextAlternates } from '../../../../src/lib/commander/alternateNotifications';
import { isUniqueViolation, conflictError, conflictMessage } from '../../../../src/lib/commander/dbErrors';
// Shared pure payout-math helpers (same math the payout screen uses, so the
// winner's payout here always matches position 1 there).
import { buildPayoutTable, collectedPrizePool, effectivePrizePool as poolFor } from './payout';
import { applyKnockoutBounty } from '../../../../src/lib/commander/tournamentBounty';


let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
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

    const { id: tournamentId } = req.query;

    if (!tournamentId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' } });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      const { entry_id, eliminated_by_id } = req.body;

      if (!entry_id) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Entry ID Required' } });
      }

      if (eliminated_by_id && String(eliminated_by_id) === String(entry_id)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A Player Cannot Eliminate Themselves' } });
      }

      // Get tournament
      const { data: tournament, error: tournamentError } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();

      if (tournamentError || !tournament) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
      }



      // Get entry being eliminated
      const { data: entry, error: entryError } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entry_id)
        .eq('tournament_id', tournamentId)
        .maybeSingle();

      if (entryError || !entry) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entry Not Found' } });
      }

      if (entry.status === 'eliminated') {
        return res.status(400).json({ success: false, error: { code: 'ALREADY_ELIMINATED', message: 'Player Already Eliminated' } });
      }

      // Count remaining players to determine finish position (this entry
      // included, so with 5 left the bust takes 5th).
      // FIELD COUNT, not seat occupancy: a 'bagged' player (multi-day, chips
      // in a bag overnight) is still alive and MUST count. Leaving them out
      // shortened the field and handed every subsequent bust a finish position
      // that was already taken, corrupting the finishing order and the payouts
      // derived from it.
      // 2026-08-20: the count and the "is this place already taken" probe used
      // to be separate statements, so two players busting at the same instant
      // on different tables could both read the same remaining count, both find
      // the place unclaimed (neither had written yet), and both be recorded in
      // it. The finishing order was then wrong, and since payouts are derived
      // from finish position, so was the money. commander_claim_finish_position
      // counts the field, picks the highest unclaimed place and performs the
      // elimination in ONE statement behind a lock on the tournament row, so
      // concurrent busts serialize instead of colliding.
      const { data: claimRows, error: claimError } = await getSupabase()
        .rpc('commander_claim_finish_position', {
          p_entry_id: entry_id,
          p_tournament_id: tournamentId,
          p_eliminated_by: eliminated_by_id || null
        });

      // uq_commander_entries_finish_position now rejects a duplicate place. The
      // RPC walks down from the field count looking for a free place, so a
      // violation here means another bust took the place inside the same
      // instant. Retrying the bust is correct and safe, so say that instead of
      // returning an opaque 500.
      if (claimError) {
        if (isUniqueViolation(claimError)) {
          return res.status(409).json({
            success: false,
            error: conflictError(claimError, { playerName: entry.player_name, action: 'Elimination' })
          });
        }
        throw claimError;
      }

      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      if (!claim || claim.finish_position == null) {
        return res.status(409).json({
          success: false,
          error: { code: 'ALREADY_ELIMINATED', message: 'Player Was Already Eliminated By Another Request' }
        });
      }

      const finishPosition = claim.finish_position;
      const remainingCount = (claim.remaining_after ?? 0) + 1;

      // ── Prize pool + payout structure (single source of math, shared with
      // payout.js so the amounts always agree) ──
      // collected = entries*buyin + rebuys*rebuy_amount + addons*addon_amount;
      // pool = actual_prizepool when set, else max(collected, guaranteed_pool).
      const [totalEntries, totalRebuys, totalAddons] = await Promise.all([
        getTotalEntries(tournamentId),
        getTotalRebuys(tournamentId),
        getTotalAddons(tournamentId)
      ]);
      // The bounty slice of each buy-in is NOT prize money (house rule:
      // charge = buyin + fee, prize = buyin - bounty), so collectedPrizePool
      // takes it out for bounty and PKO events.
      const collectedPool = collectedPrizePool(tournament, {
        entries: totalEntries, rebuys: totalRebuys, addons: totalAddons
      });
      const effectivePool = poolFor(tournament, collectedPool);

      // ONE payout table, built by the shared helper: the saved structure (or
      // the standard field-size band), the satellite seat schedule, and the
      // room's denomination rounding. The TD payouts screen and the public
      // live page build theirs the same way, so a bust can never be paid a
      // different number from the one on the display.
      const payoutTable = buildPayoutTable(tournament, effectivePool, totalEntries);

      const payoutForPosition = (position) => {
        const slot = payoutTable.rows.find(p => p.position === position);
        if (!slot) return 0;
        return Math.max(0, Number(slot.amount) || 0);
      };
      // A satellite seat winner is paid the seat value, which is exactly what
      // the table above holds for those places, so the money reconciles.
      const seatForPosition = (position) => {
        const slot = payoutTable.rows.find(p => p.position === position);
        return !!(slot && slot.is_seat);
      };

      // Calculate payout if in the money.
      // 2026-08-20 fix: when a deal/chop has been recorded (final_payouts, or
      // an amount already stamped on the entry by the Deal Calculator), that
      // agreed amount WINS. Previously every bust after a deal overwrote the
      // negotiated figure with the structure amount for that finish position,
      // silently paying players something other than what they agreed to.
      const dealTable = Array.isArray(tournament.final_payouts) ? tournament.final_payouts : [];
      const dealRow = dealTable.find(d =>
        (d.entry_id && String(d.entry_id) === String(entry_id)) ||
        (d.player_id && entry.player_id && String(d.player_id) === String(entry.player_id))
      );
      const dealAmount = dealRow != null ? Number(dealRow.amount) || 0 : null;
      const preRecordedAmount = dealTable.length > 0 ? Number(entry.payout_amount) || 0 : 0;

      const payoutAmount = dealAmount != null
        ? dealAmount
        : (preRecordedAmount > 0 ? preRecordedAmount : payoutForPosition(finishPosition));
      const payoutPosition = payoutAmount > 0 ? finishPosition : null;
      // Satellite: this finish won a SEAT, not cash. payout_amount still holds
      // the seat value so the money reconciles against the prize pool, and the
      // flag is what the results sheet and the live page label "Seat" from.
      // A recorded deal always wins, so it turns the seat flag off.
      const wonSeat = dealAmount == null && preRecordedAmount <= 0 && seatForPosition(finishPosition);

      // Update eliminated player. The status predicate makes a double-tap
      // safe: only an entry still in the tournament can be eliminated, so of
      // two racing requests exactly one wins and the other gets a 409.
      // The RPC above already set status, eliminated_at, eliminated_by,
      // finish_position and released the seat, and it only ever matches an
      // entry that was still in the tournament. All that is left is the money,
      // which is computed in JS because it needs the structure, the pool, the
      // guarantee and any recorded deal.
      const { data: eliminated, error: updateError } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          payout_amount: payoutAmount,
          payout_position: payoutPosition,
          ...(wonSeat ? {
            metadata: {
              ...(entry.metadata || {}),
              won_seat: true,
              seat_value: payoutAmount
            }
          } : {})
        })
        .eq('id', entry_id)
        .eq('tournament_id', tournamentId)
        .select(`
          *,
          profiles (id, display_name, avatar_url)
        `)
        .maybeSingle();

      if (updateError) throw updateError;

      if (!eliminated) {
        // The elimination itself succeeded (the RPC returned a row), so this is
        // only the payout write failing to find the entry. Surface the claimed
        // row rather than telling the TD the bust did not happen.
        console.warn('[eliminate.js] payout write matched no row after a successful claim', { entry_id, tournamentId });
      }

      // Handle bounty if applicable. Runs AFTER the race-guarded elimination
      // update so the losing side of a double-tap can never award a second
      // bounty. Scoped to this tournament so a stray entry id from another
      // tournament can never collect it.
      //
      // 2026-08-21: this used to be a bare bounties_collected += 1, which
      // recorded that a knockout happened but never what it was WORTH, so the
      // cage had no figure to pay against and a PKO head never grew.
      //   bounty : the eliminator is paid the flat tournament.bounty_amount.
      //   pko    : the eliminator is paid HALF the busted player's head in
      //            cash and the other HALF is added to their own head.
      // The whole transfer lives in tournamentBounty.js, which shares its
      // money math with the payout screens.
      let bountiesCollected = 0;
      let bountyAward = null;
      try {
        bountyAward = await applyKnockoutBounty(getSupabase(), {
          tournament,
          tournamentId,
          bustedEntry: eliminated || entry,
          eliminatorEntryId: eliminated_by_id || null
        });
        if (bountyAward?.awarded) bountiesCollected = 1;
      } catch (bountyErr) {
        // The elimination itself already stands. A failed bounty transfer is
        // reported, never allowed to roll the bust back.
        console.warn('[eliminate.js] Bounty transfer failed:', bountyErr?.message || bountyErr);
      }

      // Award XP if player cashed
      if (payoutAmount > 0 && entry.player_id) {
        // XP system removed
      }

      // --- Push Notification: Eliminated player ---
      if (entry.player_id) {
        fireEliminationNotification(entry.player_id, tournament, finishPosition, payoutAmount).catch(err =>
          console.warn('[eliminate.js] Push notification failed:', err.message)
        );
      }

      // --- Auto-Story: ITM milestone ---
      if (payoutAmount > 0 && entry.player_id) {
        createAutoStory(entry.player_id, 'itm', tournament, finishPosition, payoutAmount).catch(err =>
          console.warn('[eliminate.js] Auto-story failed:', err.message)
        );
      }

      // Set when the last player could not be recorded as the winner (a place-1
      // collision, or any other rejected write). Reported to the TD so the
      // finishing order is repaired before anyone is paid.
      let winnerWriteFailure = null;

      // Check if tournament should end (only 1 player left)
      if (remainingCount <= 2) {
        // Mark the winner
        // Same field definition as remainingCount above. If the last two
        // players include one who is bagged, that bagged player is the winner
        // when the other busts - searching only seated players would find
        // nobody and the tournament would never be closed out.
        const { data: winner } = await getSupabase()
          .from('commander_tournament_entries')
          .select('*')
          .eq('tournament_id', tournamentId)
          .in('status', ['seated', 'active', 'bagged'])
          .neq('id', entry_id)
          .maybeSingle();

        if (winner) {
          // Winner payout: exactly position 1 of the same structure + pool
          // math used above (and by payout.js), so the numbers always agree.
          // A recorded deal wins over the structure, same as for busts.
          const winnerDealRow = dealTable.find(d =>
            (d.entry_id && String(d.entry_id) === String(winner.id)) ||
            (d.player_id && winner.player_id && String(d.player_id) === String(winner.player_id))
          );
          const winnerAmount = winnerDealRow != null
            ? (Number(winnerDealRow.amount) || 0)
            : (dealTable.length > 0 && Number(winner.payout_amount) > 0
                ? Number(winner.payout_amount)
                : payoutForPosition(1));

          // uq_commander_entries_finish_position rejects a second row claiming
          // place 1. This write used to discard its error entirely, so a
          // collision would leave the event with no recorded winner and nobody
          // would be told. Surface it on the response instead.
          const { error: winnerError } = await getSupabase()
            .from('commander_tournament_entries')
            .update({
              status: 'winner',
              finish_position: 1,
              payout_amount: winnerAmount,
              payout_position: 1,
              metadata: {
                ...(winner.metadata || {}),
                won_at: new Date().toISOString(),
                prize_amount: winnerAmount,
                // Satellite: 1st place wins a seat, not a cash first prize.
                ...(winnerDealRow == null && seatForPosition(1)
                  ? { won_seat: true, seat_value: winnerAmount }
                  : {})
              }
            })
            .eq('id', winner.id);

          if (winnerError) {
            winnerWriteFailure = isUniqueViolation(winnerError)
              ? conflictMessage(winnerError, { finishPosition: 1, playerName: winner.player_name, action: 'Winner Recording' })
              : 'The Winner Could Not Be Recorded. Check The Finishing Order Before Paying Out.';
            console.error('[eliminate.js] winner write failed', {
              tournamentId, winner_id: winner.id,
              code: winnerError.code, message: winnerError.message, details: winnerError.details,
            });
          }

          // Award XP to winner
          if (winner.player_id) {
            // XP system removed
          }

          // --- Push Notification: Winner ---
          if (winner.player_id) {
            fireEliminationNotification(winner.player_id, tournament, 1, winnerAmount, true).catch(err =>
              console.warn('[eliminate.js] Winner push failed:', err.message)
            );
            createAutoStory(winner.player_id, 'winner', tournament, 1, winnerAmount).catch(err =>
              console.warn('[eliminate.js] Winner auto-story failed:', err.message)
            );
          }

          // End tournament. Skipped when the winner could not be written: an
          // event closed out with no first place is far harder to repair than
          // one left running for another tap of the button.
          if (!winnerWriteFailure) {
            await getSupabase()
              .from('commander_tournaments')
              .update({
                status: 'completed',
                ended_at: new Date().toISOString()
              })
              .eq('id', tournamentId);
          }
        }
      }

      // --- AUTO BREAK CHECK (post-elimination) ---
      // After a bust, there may now be enough open seats to consolidate a table.
      // This only fires if the re-entry period is already over.
      //
      // IMPORTANT: Re-fetch tournament here - the status may have changed to 'completed'
      // if this was the last elimination. checkAndExecuteAutoBreak gates on status,
      // so using a stale 'running' snapshot would incorrectly try to break the winner's table.
      const { data: freshTournament } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();

      // --- ALTERNATE AUTO-SEAT (waitlist behavior) ---
      // While registration is still open, a bust frees a seat: the
      // longest-waiting alternate is seated into it automatically before any
      // table-consolidation logic runs.
      let promotedAlternate = null;
      if (freshTournament && freshTournament.status === 'running' &&
          freshTournament.late_registration_levels != null &&
          ((freshTournament.current_level || 0) + 1) <= freshTournament.late_registration_levels) {
        try {
          promotedAlternate = await promoteNextAlternate(getSupabase(), freshTournament);
          if (promotedAlternate) {
            // The queue advanced. Tell the next few where they now stand.
            // Fire and forget: the bust is already recorded and a push outage
            // must not turn a successful elimination into a 500.
            notifyNextAlternates(getSupabase(), freshTournament);

            await logAction({ action: 'promote_alternate_auto', category: 'tournament' }, {
              venueId: freshTournament.venue_id,
              staffId: _g?.id,
              targetId: promotedAlternate.id,
              targetType: 'commander_tournament_entries',
              targetName: promotedAlternate.player_name || 'Player',
              metadata: {
                tournament_id: tournamentId,
                table_number: promotedAlternate.table_number,
                seat_number: promotedAlternate.seat_number
              },
              req
            });
          }
        } catch (altErr) {
          console.warn('[eliminate.js] Alternate auto-seat failed:', altErr.message);
        }
      }

      const autoBreakResult = freshTournament?.status !== 'completed'
        ? await checkAndExecuteAutoBreak(tournamentId, freshTournament || tournament)
        : null;


      return res.status(200).json({
        success: true,
        data: {
          // Fall back to the row the atomic claim returned if the payout write
          // could not re-read it, so the client always gets the busted entry.
          entry: eliminated || claim.entry,
          finishPosition,
          payoutAmount,
          inTheMoney: payoutAmount > 0,
          // Satellite: this finish won a seat worth payoutAmount.
          wonSeat,
          bountiesAwarded: bountiesCollected,
          // Bounty / PKO detail so the TD can read the knockout out loud and
          // the cage knows what to hand over.
          bounty: bountyAward ? {
            mode: bountyAward.mode,
            awarded: bountyAward.awarded,
            cash: bountyAward.cash,
            to_head: bountyAward.to_head,
            head_claimed: bountyAward.head_claimed,
            eliminator_bounty_value: bountyAward.eliminator_bounty_value,
            eliminator_bounty_winnings: bountyAward.eliminator_bounty_winnings
          } : undefined,
          remainingPlayers: remainingCount - 1,
          // Present only when the last player could not be recorded as the
          // winner. The tournament is deliberately left open in that case.
          winner_warning: winnerWriteFailure || undefined,
          // Present when a waiting alternate was auto-seated into the freed seat
          promoted_alternate: promotedAlternate ? {
            entry_id: promotedAlternate.id,
            player_name: promotedAlternate.player_name,
            table_number: promotedAlternate.table_number,
            seat_number: promotedAlternate.seat_number
          } : undefined,
          // Included when a table was automatically broken - frontend uses this to print receipts
          auto_break: autoBreakResult || undefined
        }
      });
    } catch (error) {
      console.warn('Eliminate player error:', error);
      // A unique violation anywhere in the bust path is a finishing-order or
      // seat collision, not a server fault.
      if (isUniqueViolation(error)) {
        return res.status(409).json({ success: false, error: conflictError(error, { action: 'Elimination' }) });
      }
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

// Field size: every non-cancelled entry (re-entries count as fresh entries).
async function getTotalEntries(tournamentId) {
  const { count } = await getSupabase()
    .from('commander_tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .neq('status', 'cancelled');

  return count || 0;
}

async function getTotalRebuys(tournamentId) {
  const { data } = await getSupabase()
    .from('commander_tournament_entries')
    .select('rebuy_count')
    .eq('tournament_id', tournamentId)

  return data?.reduce((sum, e) => sum + (e.rebuy_count || 0), 0) || 0;
}

async function getTotalAddons(tournamentId) {
  const { count } = await getSupabase()
    .from('commander_tournament_entries')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('addon_taken', true)

  return count || 0;
}

// --- Push Notification Helper ---
async function fireEliminationNotification(playerId, tournament, position, payout, isWinner = false) {
  if (!isOneSignalConfigured()) return;

  const tournamentName = tournament.name || 'Tournament';
  let title, message;

  if (isWinner) {
    title = 'Tournament Winner!';
    message = payout
      ? `Congratulations! You Won ${tournamentName}! Prize: $${payout.toLocaleString()}`
      : `Congratulations! You Won ${tournamentName}!`;
  } else if (payout > 0) {
    title = 'In The Money!';
    message = `You Finished ${addOrdinalSuffix(position)} In ${tournamentName} And Won $${payout.toLocaleString()}!`;
  } else {
    title = 'Tournament Result';
    message = `Thanks For Playing ${tournamentName}! You Finished ${addOrdinalSuffix(position)}.`;
  }

  await sendPushNotification({
    externalUserIds: [playerId],
    title,
    message,
    url: `/hub/commander/tournament/${tournament.id}/my-status`,
    data: { type: 'tournament_elimination', tournament_id: tournament.id, position, payout }
  });
}

// --- Auto-Story Helper ---
async function createAutoStory(playerId, storyType, tournament, position, payout) {
  const contentMap = {
    itm: payout
      ? `IN THE MONEY! Finished ${addOrdinalSuffix(position)} In ${tournament.name}, $${payout.toLocaleString()}`
      : `IN THE MONEY! Cashed In ${tournament.name}!`,
    winner: payout
      ? `I WON ${tournament.name}! $${payout.toLocaleString()}`
      : `I WON ${tournament.name}!`
  };

  const gradients = {
    itm: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
    winner: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 50%, #F59E0B 100%)'
  };

  await getSupabase()
    .from('social_stories')
    .insert({
      author_id: playerId,
      content: contentMap[storyType] || `Playing In ${tournament.name}`,
      media_type: 'text',
      background_color: gradients[storyType] || gradients.itm
    });
}

function addOrdinalSuffix(n) {
  if (!n) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
