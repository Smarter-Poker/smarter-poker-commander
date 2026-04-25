/**
 * Tournament Payout API — Enhanced with Auto-Calculation & Live Override
 * GET /api/commander/tournaments/:id/payout — Get payouts (saved or auto-calc)
 * POST /api/commander/tournaments/:id/payout — Save individual payout or final overrides
 * PUT /api/commander/tournaments/:id/payout — Save bulk final payouts (override mode)
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF — requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    const { id } = req.query;

    if (req.method === 'GET') return handleGetPayouts(req, res, id);
    if (req.method === 'POST') return handlePayout(req, res, id);
    if (req.method === 'PUT') return handleBulkPayouts(req, res, id);

    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleGetPayouts(req, res, tournamentId) {
  try {
    const { mode } = req.query;

    // Get tournament details
    const { data: tournament, error: tErr } = await getSupabase()
      .from('commander_tournaments')
      .select('*, commander_tournament_leaderboards(*)')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tErr) throw tErr;

    // Get all entries for prize pool calculation
    const { data: entries } = await getSupabase()
      .from('commander_tournament_entries')
      .select('*, profiles(display_name, avatar_url)')
      .eq('tournament_id', tournamentId)
      .not('status', 'eq', 'cancelled');

    const totalEntries = (entries || []).length;
    const totalRebuys = (entries || []).reduce((sum, e) => sum + (e.rebuy_count || 0), 0);
    const totalAddons = (entries || []).filter(e => e.addon_taken).length
    const buyinAmount = tournament.buyin_amount || 0;
    const buyinFee = tournament.buyin_fee || 0;
    const rebuyAmount = tournament.rebuy_amount || buyinAmount;
    const addonAmount = tournament.addon_amount || buyinAmount;
    const prizePool = (totalEntries * buyinAmount) + (totalRebuys * rebuyAmount) + (totalAddons * addonAmount);
    const houseFees = totalEntries * buyinFee;

    // If calculate mode, compute auto payouts from payout_structure
    if (mode === 'calculate') {
      const structure = parsePayoutStructure(tournament.payout_structure);
      const calculated = structure.map((slot, idx) => {
        const percent = slot.percentage || slot.percent || 0;
        const amount = Math.round(prizePool * (percent / 100));
        return {
          position: slot.position || idx + 1,
          percentage: percent,
          amount,
          player_name: null,
          player_id: null
        };
      });

      // If we have eliminated players with finish positions, match them
      const eliminated = (entries || [])
        .filter(e => e.finish_position)
        .sort((a, b) => a.finish_position - b.finish_position);

      calculated.forEach(slot => {
        const match = eliminated.find(e => e.finish_position === slot.position);
        if (match) {
          slot.player_name = match.profiles?.display_name || match.player_name;
          slot.player_id = match.player_id;
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          calculated_payouts: calculated,
          prize_pool: prizePool,
          house_fees: houseFees,
          total_entries: totalEntries,
          total_rebuys: totalRebuys,
          total_addons: totalAddons,
          final_payouts: tournament.final_payouts || null,
          guaranteed: tournament.guaranteed_pool || 0,
          is_overlay: (tournament.guaranteed_pool || 0) > prizePool
        }
      });
    }

    // Default: return saved payouts
    const { data: payouts, error } = await getSupabase()
      .from('commander_tournament_entries')
      .select('*, profiles(id, display_name, avatar_url)')
      .eq('tournament_id', tournamentId)
      .not('payout_amount', 'is', null)
      .order('finish_position', { ascending: true })
          .limit(100);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: {
        payouts: payouts || [],
        prize_pool: prizePool,
        house_fees: houseFees,
        total_entries: totalEntries,
        final_payouts: tournament.final_payouts || null,
        guaranteed: tournament.guaranteed_pool || 0
      }
    });
  } catch (error) {
    console.warn('Get payouts error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch payouts' } });
  }
}

async function handlePayout(req, res, tournamentId) {
  const { player_id, place, amount } = req.body;

  if (!player_id || !place || !amount) {
    return res.status(400).json({ success: false, error: { message: 'player_id, place, and amount required' } });
  }

  try {
    const { data: tournament } = await getSupabase()
      .from('commander_tournaments')
      .select('venue_id, buyin_amount, buyin_fee, leaderboard_id')
      .eq('id', tournamentId)
      .maybeSingle();

    const { data: entry, error } = await getSupabase()
      .from('commander_tournament_entries')
      .update({
        finish_position: place,
        payout_amount: amount,
        payout_position: place,
        status: 'winner'
      })
      .eq('tournament_id', tournamentId)
      .eq('player_id', player_id)
      .select()
      .maybeSingle();

    if (error) throw error;

    // Tax event tracking (>$5000)
    if (amount >= 5000 && tournament) {
      const totalBuyin = (tournament.buyin_amount || 0) + (tournament.buyin_fee || 0);
      await getSupabase().from('commander_tax_events').insert({
        venue_id: tournament.venue_id,
        player_id,
        event_type: 'tournament_win',
        gross_amount: amount,
        buy_in: totalBuyin,
        net_amount: amount - totalBuyin,
        withholding_required: amount >= 5000
      });
    }

    // Auto-award leaderboard points for this finish
    if (tournament?.leaderboard_id && entry) {
      await awardLeaderboardPoints(tournament.leaderboard_id, tournamentId, entry);
    }

    return res.status(200).json({ success: true, data: { entry } });
  } catch (error) {
    console.warn('Payout error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to record payout' } });
  }
}

/**
 * Bulk final payouts — save all overridden amounts at once
 * Used for deal/chop scenarios at final table
 */
async function handleBulkPayouts(req, res, tournamentId) {
  try {
    const { payouts } = req.body;
    // payouts = [{ player_id, position, amount }, ...]

    if (!payouts || !Array.isArray(payouts)) {
      return res.status(400).json({ success: false, error: { message: 'payouts array required' } });
    }

    // Get tournament for leaderboard
    const { data: tournament } = await getSupabase()
      .from('commander_tournaments')
      .select('venue_id, buyin_amount, buyin_fee, leaderboard_id')
      .eq('id', tournamentId)
      .maybeSingle();

    // Update each entry
    const results = [];
    for (const p of payouts) {
      const { data: entry, error } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          finish_position: p.position,
          payout_amount: p.amount,
          payout_position: p.position,
          status: 'winner'
        })
        .eq('tournament_id', tournamentId)
        .eq('player_id', p.player_id)
        .select()
        .maybeSingle();

      if (!error && entry) {
        results.push(entry);
        // Auto-award leaderboard points
        if (tournament?.leaderboard_id) {
          await awardLeaderboardPoints(tournament.leaderboard_id, tournamentId, entry);
        }
      }
    }

    // Save final_payouts to tournament record for reference
    await getSupabase()
      .from('commander_tournaments')
      .update({ final_payouts: payouts })
      .eq('id', tournamentId);

    return res.status(200).json({
      success: true,
      data: { updated: results.length, payouts: results }
    });
  } catch (error) {
    console.warn('Bulk payout error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to save payouts' } });
  }
}

/**
 * Auto-award leaderboard points when a player finishes
 */
async function awardLeaderboardPoints(leaderboardId, tournamentId, entry) {
  try {
    // Get leaderboard point structure
    const { data: lb } = await getSupabase()
      .from('commander_tournament_leaderboards')
      .select('point_for_entry, point_structure')
      .eq('id', leaderboardId)
      .maybeSingle();

    if (!lb) return;

    const entryPts = lb.point_for_entry || 0;
    const structure = lb.point_structure || [];
    const positionPts = structure.find(s => s.position === entry.finish_position)?.points || 0;

    if (entryPts === 0 && positionPts === 0) return;

    // Upsert points (avoid duplicates)
    const { data: existing } = await getSupabase()
      .from('commander_tournament_points')
      .select('id')
      .eq('leaderboard_id', leaderboardId)
      .eq('tournament_id', tournamentId)
      .eq('player_id', entry.player_id)
      .maybeSingle();

    if (existing) {
      await getSupabase()
        .from('commander_tournament_points')
        .update({
          points: positionPts,
          entry_points: entryPts,
          finish_position: entry.finish_position
        })
        .eq('id', existing.id);
    } else {
      await getSupabase()
        .from('commander_tournament_points')
        .insert({
          leaderboard_id: leaderboardId,
          tournament_id: tournamentId,
          player_id: entry.player_id,
          player_name: entry.player_name,
          points: positionPts,
          entry_points: entryPts,
          finish_position: entry.finish_position
        });
    }
  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Award points error:', err);
  }
}
