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
import { parsePayoutStructure } from '../../../../src/lib/parseBlindStructure';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { logAction } from '../../../../src/lib/commander/audit';
import { promoteNextAlternate } from '../../../../src/lib/commander/tournamentSeating';
// Shared pure payout-math helpers (same math the payout screen uses, so the
// winner's payout here always matches position 1 there).
import { generatePayoutTable, normalizePayoutSlot } from './payout';


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
      const { count: remainingCount } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .in('status', ['seated', 'active'])

      let finishPosition = remainingCount;

      // Race guard: two near-simultaneous eliminations can read the same
      // remaining count. If this finish position is already claimed by another
      // entry, step down to the next unclaimed one (per-entry, so re-entries
      // that busted earlier keep their own positions).
      while (finishPosition > 1) {
        const { count: taken } = await getSupabase()
          .from('commander_tournament_entries')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', tournamentId)
          .eq('finish_position', finishPosition)
          .neq('id', entry_id);
        if (!taken) break;
        finishPosition -= 1;
      }

      // ── Prize pool + payout structure (single source of math, shared with
      // payout.js so the amounts always agree) ──
      // collected = entries*buyin + rebuys*rebuy_amount + addons*addon_amount;
      // pool = actual_prizepool when set, else max(collected, guaranteed_pool).
      const [totalEntries, totalRebuys, totalAddons] = await Promise.all([
        getTotalEntries(tournamentId),
        getTotalRebuys(tournamentId),
        getTotalAddons(tournamentId)
      ]);
      const collectedPool = (totalEntries * (tournament.buyin_amount || 0)) +
        (totalRebuys * (tournament.rebuy_amount || 0)) +
        (totalAddons * (tournament.addon_amount || 0));
      const actualPool = Number(tournament.actual_prizepool) || 0;
      const effectivePrizePool = actualPool > 0
        ? actualPool
        : Math.max(collectedPool, Number(tournament.guaranteed_pool) || 0);

      let payoutStructure = parsePayoutStructure(tournament.payout_structure).map(normalizePayoutSlot);
      if (payoutStructure.length === 0) {
        // No saved structure: use the standard field-size-band table so busts
        // and the payout screen agree.
        payoutStructure = generatePayoutTable(totalEntries, tournament.paying_places);
      }

      const payoutForPosition = (position) => {
        const slot = payoutStructure.find(p => p.position === position);
        if (!slot) return 0;
        if (slot.percentage) return Math.floor(effectivePrizePool * slot.percentage / 100);
        if (slot.amount) return slot.amount;
        return 0;
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

      // Update eliminated player. The status predicate makes a double-tap
      // safe: only an entry still in the tournament can be eliminated, so of
      // two racing requests exactly one wins and the other gets a 409.
      const { data: eliminated, error: updateError } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          status: 'eliminated',
          eliminated_at: new Date().toISOString(),
          eliminated_by: eliminated_by_id || null,
          finish_position: finishPosition,
          payout_amount: payoutAmount,
          payout_position: payoutPosition,
          table_number: null,
          seat_number: null,
        })
        .eq('id', entry_id)
        .in('status', ['registered', 'seated', 'active'])
        .select(`
          *,
          profiles (id, display_name, avatar_url)
        `)
        .maybeSingle();

      if (updateError) throw updateError;

      if (!eliminated) {
        return res.status(409).json({ success: false, error: { code: 'ALREADY_ELIMINATED', message: 'Player Was Already Eliminated By Another Request' } });
      }

      // Handle bounty if applicable. Runs AFTER the race-guarded elimination
      // update so the losing side of a double-tap can never award a second
      // bounty. Scoped to this tournament so a stray entry id from another
      // tournament can never collect it.
      let bountiesCollected = 0;
      if (tournament.bounty_amount && eliminated_by_id) {
        const { data: eliminator } = await getSupabase()
          .from('commander_tournament_entries')
          .select('bounties_collected, metadata')
          .eq('id', eliminated_by_id)
          .eq('tournament_id', tournamentId)
          .maybeSingle();

        if (eliminator) {
          await getSupabase()
            .from('commander_tournament_entries')
            .update({
              bounties_collected: (eliminator.bounties_collected || 0) + 1,
              metadata: {
                ...(eliminator.metadata || {}),
                last_bounty_at: new Date().toISOString()
              }
            })
            .eq('id', eliminated_by_id)
            .eq('tournament_id', tournamentId);

          bountiesCollected = 1;
        }
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

      // Check if tournament should end (only 1 player left)
      if (remainingCount <= 2) {
        // Mark the winner
        const { data: winner } = await getSupabase()
          .from('commander_tournament_entries')
          .select('*')
          .eq('tournament_id', tournamentId)
          .in('status', ['seated', 'active'])
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

          await getSupabase()
            .from('commander_tournament_entries')
            .update({
              status: 'winner',
              finish_position: 1,
              payout_amount: winnerAmount,
              payout_position: 1,
              metadata: {
                ...(winner.metadata || {}),
                won_at: new Date().toISOString(),
                prize_amount: winnerAmount
              }
            })
            .eq('id', winner.id);

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

          // End tournament
          await getSupabase()
            .from('commander_tournaments')
            .update({
              status: 'completed',
              ended_at: new Date().toISOString()
            })
            .eq('id', tournamentId);
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
          entry: eliminated,
          finishPosition,
          payoutAmount,
          inTheMoney: payoutAmount > 0,
          bountiesAwarded: bountiesCollected,
          remainingPlayers: remainingCount - 1,
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
