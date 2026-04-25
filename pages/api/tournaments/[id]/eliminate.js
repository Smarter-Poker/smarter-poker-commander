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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id: tournamentId } = req.query;

    if (!tournamentId) {
      return res.status(400).json({ success: false, error: 'Tournament ID required' });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      const { entry_id, eliminated_by_id } = req.body;

      if (!entry_id) {
        return res.status(400).json({ success: false, error: 'Entry ID required' });
      }

      // Get tournament
      const { data: tournament, error: tournamentError } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();

      if (tournamentError || !tournament) {
        return res.status(404).json({ success: false, error: 'Tournament not found' });
      }



      // Get entry being eliminated
      const { data: entry, error: entryError } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entry_id)
        .eq('tournament_id', tournamentId)
        .maybeSingle();

      if (entryError || !entry) {
        return res.status(404).json({ success: false, error: 'Entry not found' });
      }

      if (entry.status === 'eliminated') {
        return res.status(400).json({ success: false, error: 'Player already eliminated' });
      }

      // Count remaining players to determine finish position
      const { count: remainingCount } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .in('status', ['seated', 'active'])

      const finishPosition = remainingCount;

      // Calculate payout if in the money
      const payoutStructure = parsePayoutStructure(tournament.payout_structure);
      let payoutAmount = 0;
      let payoutPosition = null;

      // Check if this position pays
      const payoutInfo = payoutStructure.find(p => p.position === finishPosition);
      if (payoutInfo) {
        // Calculate prize pool
        const totalEntries = tournament.current_entries || 0;
        const totalRebuys = await getTotalRebuys(tournamentId);
        const totalAddons = await getTotalAddons(tournamentId);

        const prizePool = (totalEntries * tournament.buyin_amount) +
          (totalRebuys * (tournament.rebuy_amount || 0)) +
          (totalAddons * (tournament.addon_amount || 0));

        // Guaranteed pool adjustment
        const effectivePrizePool = Math.max(prizePool, tournament.guaranteed_pool || 0);

        // Calculate payout (percentage or fixed)
        if (payoutInfo.percentage) {
          payoutAmount = Math.floor(effectivePrizePool * payoutInfo.percentage / 100);
        } else if (payoutInfo.amount) {
          payoutAmount = payoutInfo.amount;
        }

        payoutPosition = finishPosition;
      }

      // Handle bounty if applicable
      let bountiesCollected = 0;
      if (tournament.bounty_amount && eliminated_by_id) {
        // Award bounty to eliminator (read current + increment, preserving metadata)
        const { data: eliminator } = await getSupabase()
          .from('commander_tournament_entries')
          .select('bounties_collected, metadata')
          .eq('id', eliminated_by_id)
          .maybeSingle();

        await getSupabase()
          .from('commander_tournament_entries')
          .update({
            bounties_collected: (eliminator?.bounties_collected || 0) + 1,
            metadata: {
              ...(eliminator?.metadata || {}),
              last_bounty_at: new Date().toISOString()
            }
          })
          .eq('id', eliminated_by_id);

        bountiesCollected = 1;
      }

      // Update eliminated player
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
        .select(`
          *,
          profiles (id, display_name, avatar_url)
        `)
        .maybeSingle();

      if (updateError) throw updateError;

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
          // Calculate winner payout
          const winnerPayout = payoutStructure.find(p => p.position === 1);
          let winnerAmount = 0;

          if (winnerPayout) {
            const totalEntries = tournament.current_entries || 0;
            const totalRebuys = await getTotalRebuys(tournamentId);
            const totalAddons = await getTotalAddons(tournamentId);

            const prizePool = (totalEntries * tournament.buyin_amount) +
              (totalRebuys * (tournament.rebuy_amount || 0)) +
              (totalAddons * (tournament.addon_amount || 0));

            const effectivePrizePool = Math.max(prizePool, tournament.guaranteed_pool || 0);

            if (winnerPayout.percentage) {
              winnerAmount = Math.floor(effectivePrizePool * winnerPayout.percentage / 100);
            } else if (winnerPayout.amount) {
              winnerAmount = winnerPayout.amount;
            }
          }

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
      // IMPORTANT: Re-fetch tournament here — the status may have changed to 'completed'
      // if this was the last elimination. checkAndExecuteAutoBreak gates on status,
      // so using a stale 'running' snapshot would incorrectly try to break the winner's table.
      const { data: freshTournament } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();

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
          remainingPlayers: remainingCount - 1,
          // Included when a table was automatically broken — frontend uses this to print receipts
          auto_break: autoBreakResult || undefined
        }
      });
    } catch (error) {
      console.warn('Eliminate player error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
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
      ? `Congratulations! You won ${tournamentName}! Prize: $${payout.toLocaleString()}`
      : `Congratulations! You won ${tournamentName}!`;
  } else if (payout > 0) {
    title = 'In The Money!';
    message = `You finished ${addOrdinalSuffix(position)} in ${tournamentName} and won $${payout.toLocaleString()}!`;
  } else {
    title = 'Tournament Result';
    message = `Thanks for playing ${tournamentName}! You finished ${addOrdinalSuffix(position)}.`;
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
      ? `IN THE MONEY! Finished ${addOrdinalSuffix(position)} in ${tournament.name} — $${payout.toLocaleString()}`
      : `IN THE MONEY! Cashed in ${tournament.name}!`,
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
      content: contentMap[storyType] || `Playing in ${tournament.name}`,
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
