/**
 * Tournament Payout API - Enhanced with Auto-Calculation & Live Override
 * GET /api/commander/tournaments/:id/payout - Get payouts (saved or auto-calc)
 * POST /api/commander/tournaments/:id/payout - Save individual payout or final overrides
 * PUT /api/commander/tournaments/:id/payout - Save bulk final payouts (override mode)
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

// Auth: STAFF - requires valid staff session
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

    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

// ---------------------------------------------------------------------------
// Pure payout-math helpers (shared by calculate mode below)
// ---------------------------------------------------------------------------

// Normalize a payout_structure row to { position, percentage, amount }.
// Accepts { position | place } and { percentage | pct | percent } shapes.
export function normalizePayoutSlot(slot, idx) {
  return {
    position: Number(slot?.position ?? slot?.place ?? (idx + 1)),
    percentage: Number(slot?.percentage ?? slot?.pct ?? slot?.percent ?? 0) || 0,
    amount: slot?.amount != null ? Number(slot.amount) : null
  };
}

// Standard percentage tables for 1-10 paid places.
const STANDARD_PAYOUT_TABLES = {
  1: [100],
  2: [65, 35],
  3: [50, 30, 20],
  4: [45, 27, 18, 10],
  5: [40, 25, 16, 11, 8],
  6: [38, 24, 15, 10, 7, 6],
  7: [36, 23, 15, 10, 7, 5, 4],
  8: [33.5, 21, 14, 10, 7.5, 6, 4.5, 3.5],
  9: [31.5, 20, 13.5, 10, 7.5, 6, 4.75, 3.75, 3],
  10: [30, 19.5, 13, 9.5, 7.25, 5.75, 4.5, 3.75, 3.5, 3.25]
};

// Field-size band -> number of paid places (roughly 10-15% of the field).
function payingPlacesForField(fieldSize) {
  const n = Math.max(1, Math.floor(Number(fieldSize) || 0) || 1);
  if (n <= 4) return 1;
  if (n <= 10) return 2;
  if (n <= 17) return 3;
  if (n <= 27) return 4;
  if (n <= 39) return 5;
  if (n <= 51) return 6;
  if (n <= 67) return 8;
  if (n <= 88) return 9;
  if (n <= 100) return 10;
  return Math.min(Math.ceil(n * 0.12), 100);
}

// Generate a standard payout table when a tournament has no payout_structure.
// Returns [{ position, percentage }] whose percentages total exactly 100.
export function generatePayoutTable(fieldSize, payingPlaces = null) {
  const places = Math.max(1, Math.floor(Number(payingPlaces) || 0) || payingPlacesForField(fieldSize));
  if (STANDARD_PAYOUT_TABLES[places]) {
    return STANDARD_PAYOUT_TABLES[places].map((pct, i) => ({ position: i + 1, percentage: pct }));
  }
  // Larger fields: smooth decay curve, normalized to exactly 100.
  const weights = [];
  let total = 0;
  for (let i = 1; i <= places; i++) {
    const w = 1 / Math.pow(i, 0.82);
    weights.push(w);
    total += w;
  }
  const pcts = weights.map(w => Math.floor((w / total) * 10000) / 100);
  const used = pcts.reduce((s, p) => s + p, 0);
  pcts[0] = Math.round((pcts[0] + (100 - used)) * 100) / 100; // remainder to 1st place
  return pcts.map((pct, i) => ({ position: i + 1, percentage: pct }));
}

// Effective prize pool: actual_prizepool (when set) wins, otherwise
// max(collected, guaranteed_pool).
export function effectivePrizePool(tournament, collected) {
  const actual = Number(tournament?.actual_prizepool) || 0;
  if (actual > 0) return actual;
  return Math.max(collected, Number(tournament?.guaranteed_pool) || 0);
}

// Allocate whole-dollar amounts from percentage slots so they sum to the pool.
// Each slot is floored; when the structure totals ~100%, the rounding
// remainder is added to 1st place so the amounts sum to the pool exactly.
export function allocateAmounts(slots, pool) {
  const amounts = slots.map(s => Math.floor(pool * (s.percentage || 0) / 100));
  const totalPct = slots.reduce((s, p) => s + (p.percentage || 0), 0);
  if (amounts.length > 0 && Math.abs(totalPct - 100) <= 0.5) {
    const remainder = Math.round(pool - amounts.reduce((s, a) => s + a, 0));
    if (remainder > 0) amounts[0] += remainder;
  }
  return amounts;
}

async function handleGetPayouts(req, res, tournamentId) {
  try {
    const { mode } = req.query;

    // Get tournament details
    const { data: tournament, error: tErr } = await getSupabase()
      .from('commander_tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tErr) throw tErr;

    if (!tournament) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
    }

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
    // Collected pool uses the REAL per-item amounts (a null rebuy/addon price
    // collects nothing; it must not silently default to the buy-in).
    const rebuyAmount = tournament.rebuy_amount || 0;
    const addonAmount = tournament.addon_amount || 0;
    const collectedPool = (totalEntries * buyinAmount) + (totalRebuys * rebuyAmount) + (totalAddons * addonAmount);
    // Effective pool: actual_prizepool wins; otherwise max(collected, guaranteed).
    const prizePool = effectivePrizePool(tournament, collectedPool);
    const overlay = Math.max(0, (Number(tournament.guaranteed_pool) || 0) - collectedPool);
    const houseFees = totalEntries * buyinFee;

    // If calculate mode, compute auto payouts from payout_structure
    if (mode === 'calculate') {
      let structure = parsePayoutStructure(tournament.payout_structure).map(normalizePayoutSlot);
      // No saved payout_structure: generate a standard field-size-band table.
      if (structure.length === 0) {
        structure = generatePayoutTable(totalEntries, tournament.paying_places);
      }
      // Percentage slots are floored to whole dollars with the rounding
      // remainder added to 1st place so the amounts sum to the pool exactly.
      const allocated = allocateAmounts(structure, prizePool);
      const calculated = structure.map((slot, idx) => {
        const percent = slot.percentage || 0;
        // Fixed-amount slots (no percentage) pass through their amount.
        const amount = (!percent && slot.amount != null) ? slot.amount : allocated[idx];
        return {
          position: slot.position || idx + 1,
          percentage: percent,
          amount,
          player_name: null,
          player_id: null,
          entry_id: null
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
          // 2026-07-25 audit fix: carry entry_id so bulk saves can target the entry row
          slot.entry_id = match.id;
        }
      });

      // 2026-07-25 audit fix: project still-active players (chip-count order) into
      // the unfilled top slots so deal/chop saves can identify their entries even
      // though they have no finish_position (and possibly no player_id).
      const activeEntries = (entries || [])
        .filter(e => !e.finish_position && !['cancelled', 'eliminated'].includes(e.status))
        .sort((a, b) => (b.current_chips || 0) - (a.current_chips || 0));
      let activeIdx = 0;
      calculated.forEach(slot => {
        if (!slot.entry_id && !slot.player_id && activeIdx < activeEntries.length) {
          const e = activeEntries[activeIdx++];
          slot.player_name = e.profiles?.display_name || e.player_name;
          slot.player_id = e.player_id || null;
          slot.entry_id = e.id;
          slot.is_projected = true;
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          calculated_payouts: calculated,
          prize_pool: prizePool,
          collected_pool: collectedPool,
          overlay,
          house_fees: houseFees,
          total_entries: totalEntries,
          total_rebuys: totalRebuys,
          total_addons: totalAddons,
          final_payouts: tournament.final_payouts || null,
          guaranteed: tournament.guaranteed_pool || 0,
          is_overlay: overlay > 0
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
        collected_pool: collectedPool,
        overlay,
        house_fees: houseFees,
        total_entries: totalEntries,
        final_payouts: tournament.final_payouts || null,
        guaranteed: tournament.guaranteed_pool || 0
      }
    });
  } catch (error) {
    console.warn('Get payouts error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Fetch Payouts' } });
  }
}

async function handlePayout(req, res, tournamentId) {
  const { player_id, place } = req.body;
  const amount = Number(req.body.amount);

  // amount may legitimately be 0 (e.g. a voided payout correction); only
  // reject missing/non-numeric/negative values.
  if (!player_id || !place || !Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'player_id, place, And A Non-Negative amount Required' } });
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
        // Only 1st place is the winner; every other paid finish is 'cashed'.
        status: Number(place) === 1 ? 'winner' : 'cashed'
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
    if (tournament && entry) {
      await awardTournamentPoints(tournament, tournamentId, entry);
    }

    return res.status(200).json({ success: true, data: { entry } });
  } catch (error) {
    console.warn('Payout error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Record Payout' } });
  }
}

/**
 * Bulk final payouts - save all overridden amounts at once
 * Used for deal/chop scenarios at final table
 */
async function handleBulkPayouts(req, res, tournamentId) {
  try {
    const { payouts } = req.body;
    // payouts = [{ entry_id?, player_id?, position, amount }, ...]
    //
    // 2026-08-20 fix: deal_only mode. Applying a chop to players who are still
    // seated/active used to stamp status winner/cashed plus a finish_position
    // on each of them. The stats trigger counts only seated/active, so a deal
    // instantly dropped players_remaining to zero and every display showed the
    // tournament as finished while the players were still playing it out.
    // With deal_only (the default for the Deal Calculator) the money is
    // recorded against the entries and in final_payouts, but status and
    // finish_position are left alone so play continues and eliminate.js
    // assigns the real finishing order. Send deal_only: false to force the
    // old finalize-now behavior (paying out a completed tournament).
    const dealOnly = req.body?.deal_only !== false;

    if (!payouts || !Array.isArray(payouts)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'payouts Array Required' } });
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
      // 2026-07-25 audit fix: identify the entry by entry_id when provided
      // (chop entries for still-active players may lack player_id); fallback
      // to player_id, and skip rows with neither identifier.
      // In deal_only mode record the money without ending anyone's tournament.
      const updatePayload = dealOnly
        ? { payout_amount: p.amount, payout_position: p.position }
        : {
            finish_position: p.position,
            payout_amount: p.amount,
            payout_position: p.position,
            // Only 1st place is the winner; every other paid finish is 'cashed'.
            status: Number(p.position) === 1 ? 'winner' : 'cashed'
          };

      let updateQuery = getSupabase()
        .from('commander_tournament_entries')
        .update(updatePayload)
        .eq('tournament_id', tournamentId);

      if (p.entry_id) {
        updateQuery = updateQuery.eq('id', p.entry_id);
      } else if (p.player_id) {
        updateQuery = updateQuery.eq('player_id', p.player_id);
      } else {
        continue;
      }

      const { data: entry, error } = await updateQuery
        .select()
        .maybeSingle();

      if (!error && entry) {
        results.push(entry);
        // Auto-award leaderboard points only when finishing order is final.
        // In deal_only mode finish_position is intentionally not set yet, so
        // awarding here would score everyone off a stale or missing position.
        if (tournament && !dealOnly) {
          await awardTournamentPoints(tournament, tournamentId, entry);
        }
      }
    }

    // Persist the total paid out as the actual prize pool, and the final
    // override table itself in final_payouts (real jsonb column; the GET
    // handler reads it back for the payouts screen).
    const actualPrizepool = payouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    if (actualPrizepool > 0) {
      await getSupabase()
        .from('commander_tournaments')
        .update({ actual_prizepool: actualPrizepool, final_payouts: payouts })
        .eq('id', tournamentId);
    }

    return res.status(200).json({
      success: true,
      data: {
        updated: results.length,
        payouts: results,
        deal_only: dealOnly,
        message: dealOnly
          ? 'Deal Recorded. Play Continues And Finishing Order Is Still Assigned On Elimination.'
          : 'Final Payouts Saved.'
      }
    });
  } catch (error) {
    console.warn('Bulk payout error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Save Payouts' } });
  }
}

// Fallback finish-position -> points map used when the venue has no active
// leaderboard with a point_structure. FLAG: confirm the intended points rule.
const DEFAULT_FINISH_POINTS = { 1: 100, 2: 70, 3: 50, 4: 40, 5: 30, 6: 25, 7: 20, 8: 15, 9: 10 };

/**
 * Auto-award tournament leaderboard points when a player finishes.
 * Uses the tournament's own leaderboard_id when set, otherwise resolves the
 * venue's active leaderboard for its point_structure, otherwise falls back to a
 * default finish-position map. Rows are upserted into commander_tournament_points
 * keyed on tournament_id + player_id (or player_name when player_id is absent).
 */
async function awardTournamentPoints(tournament, tournamentId, entry) {
  try {
    // Resolve the leaderboard: tournament.leaderboard_id wins, then the
    // venue's active leaderboard.
    let leaderboardId = null;
    let entryPts = 0;
    let structure = [];
    let lb = null;
    if (tournament?.leaderboard_id) {
      const { data } = await getSupabase()
        .from('commander_tournament_leaderboards')
        .select('id, point_for_entry, point_structure')
        .eq('id', tournament.leaderboard_id)
        .maybeSingle();
      lb = data;
    }
    if (!lb && tournament?.venue_id != null) {
      const { data } = await getSupabase()
        .from('commander_tournament_leaderboards')
        .select('id, point_for_entry, point_structure')
        .eq('venue_id', tournament.venue_id)
        .eq('is_active', true)
        .order('season_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      lb = data;
    }
    if (lb) {
      leaderboardId = lb.id;
      entryPts = lb.point_for_entry || 0;
      structure = lb.point_structure || [];
    }

    const positionPts = leaderboardId
      ? (structure.find(s => s.position === entry.finish_position)?.points || 0)
      : (DEFAULT_FINISH_POINTS[entry.finish_position] || 0);

    if (entryPts === 0 && positionPts === 0) return;

    // Skip rows we cannot key on.
    if (!entry.player_id && !entry.player_name) return;

    // Upsert points (avoid duplicates) keyed on tournament + player.
    let existingQuery = getSupabase()
      .from('commander_tournament_points')
      .select('id')
      .eq('tournament_id', tournamentId);
    existingQuery = entry.player_id
      ? existingQuery.eq('player_id', entry.player_id)
      : existingQuery.eq('player_name', entry.player_name);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      await getSupabase()
        .from('commander_tournament_points')
        .update({
          leaderboard_id: leaderboardId,
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
          player_id: entry.player_id || null,
          player_name: entry.player_name || null,
          points: positionPts,
          entry_points: entryPts,
          finish_position: entry.finish_position
        });
    }
  } catch (err) {
    console.warn('Award points error:', err);
  }
}
