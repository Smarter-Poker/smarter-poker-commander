/**
 * Tournament Reports API
 * GET /api/commander/tournaments/[id]/reports?type=registration|cashier|activity
 * Provides detailed reporting for TD operations
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';
// Shared money math so the reports reconcile with the payouts screen.
import {
  collectedPrizePool,
  collectedBountyPool,
  bountyPortionPerEntry,
  effectivePrizePool
} from './payout';
import { entryBountyValue, entryBountyWinnings, hasBounties } from '../../../../src/lib/commander/tournamentBounty';
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

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

      const _staff = await guardStaff(req, res);
      if (!_staff) return;

      if (req.method !== 'GET') {
          return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
      }

      const { id: tournamentId, type } = req.query;

      switch (type) {
          case 'registration': return registrationReport(req, res, tournamentId, _staff);
          case 'cashier': return cashierReport(req, res, tournamentId, _staff);
          case 'activity': return activityReport(req, res, tournamentId, _staff);
          default:
              return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type Required: registration, cashier, Or activity' } });
      }

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

/**
 * Registration Report - per-entry breakdown
 * Player name, seat, buy-in, payment method, cashier, timestamp
 */
async function registrationReport(req, res, tournamentId, staff) {
    try {
        const { data: tournament } = await getSupabase()
            .from('commander_tournaments')
            // tournament_type, bounty_amount and settings are needed for the
            // bounty slice that is held out of the prize pool.
            .select('name, venue_id, tournament_type, buyin_amount, buyin_fee, bounty_amount, rebuy_amount, addon_amount, guaranteed_pool, actual_prizepool, settings, scheduled_start')
            .eq('id', tournamentId)
            .maybeSingle();

        if (!tournament) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
        }

        // Venue scope: this report carries player names, payment methods and
        // cashier attribution. See src/lib/commander/venueScope.js.
        if (denyCrossVenue(res, staff, tournament)) return;

        // payment_method and cashier_staff_id ARE real columns on
        // commander_tournament_entries (verified against the live schema
        // 2026-08-19); registration writes them, so the report surfaces them.
        //
        // bounty_value/bounty_winnings arrive with migration
        // 20260821130000_commander_entry_bounty_columns.sql. Selected optionally so
        // this report keeps working on a deploy that lands before it, in which
        // case the numbers come out of metadata instead.
        const BASE_ENTRY_COLUMNS = `
        id, player_id, player_name, status, table_number, seat_number,
        registration_method, payment_method, cashier_staff_id,
        rebuy_count, addon_taken, payout_amount, finish_position,
        registered_at, eliminated_at, current_chips,
        bounties_collected, metadata,
        profiles (id, display_name, avatar_url)`;

        const entriesQuery = (columns) => getSupabase()
            .from('commander_tournament_entries')
            .select(columns)
            .eq('tournament_id', tournamentId)
            .order('registered_at', { ascending: true });

        let { data: entries, error } = await entriesQuery(
            `${BASE_ENTRY_COLUMNS}, bounty_value, bounty_winnings`
        );
        if (error && (error.code === '42703' || error.code === 'PGRST204' ||
            /column .* does not exist/i.test(String(error.message || '')))) {
            ({ data: entries, error } = await entriesQuery(BASE_ENTRY_COLUMNS));
        }

        if (error) throw error;

        // Calculate summary. Prize pool rule (same as payout.js/eliminate.js):
        // collected = entries*buyin + rebuys*rebuy_amount + addons*addon_amount;
        // pool = actual_prizepool when set, else max(collected, guaranteed_pool).
        const nonCancelled = (entries || []).filter(e => e.status !== 'cancelled');
        const totalEntries = nonCancelled.length;
        const totalRebuys = nonCancelled.reduce((sum, e) => sum + (e.rebuy_count || 0), 0);
        const totalAddons = nonCancelled.filter(e => e.addon_taken).length;
        const buyinAmount = tournament?.buyin_amount || 0;
        const buyinFee = tournament?.buyin_fee || 0;
        const rebuyAmount = tournament?.rebuy_amount || 0;
        const addonAmount = tournament?.addon_amount || 0;
        const totalBuyins = totalEntries * (buyinAmount + buyinFee);
        const totalRebuyRevenue = totalRebuys * rebuyAmount;
        const totalAddonRevenue = totalAddons * addonAmount;
        const totalRevenue = totalBuyins + totalRebuyRevenue + totalAddonRevenue;
        const houseFees = totalEntries * buyinFee;
        // 2026-08-21 fix: the bounty slice of a bounty/PKO buy-in funds the
        // bounties, not the prize pool. It used to be counted as prize money,
        // so a $50 + $50 bounty event reported twice the prize pool it had.
        const collectedPool = collectedPrizePool(tournament, {
            entries: totalEntries, rebuys: totalRebuys, addons: totalAddons
        });
        const bountyPool = collectedBountyPool(tournament, {
            entries: totalEntries, rebuys: totalRebuys
        });
        const prizePool = effectivePrizePool(tournament, collectedPool);
        const overlay = Math.max(0, (Number(tournament?.guaranteed_pool) || 0) - collectedPool);

        // Bounty winnings per player, for the cage sheet. In a PKO this is the
        // cash half of every head that player knocked out; in a standard
        // bounty event it is knockouts * bounty_amount.
        const bountyLeaderboard = hasBounties(tournament)
            ? nonCancelled
                .map(e => ({
                    player_name: e.profiles?.display_name || e.player_name || 'Player',
                    player_id: e.player_id || null,
                    entry_id: e.id,
                    knockouts: Number(e.bounties_collected) || 0,
                    bounty_winnings: entryBountyWinnings(e),
                    bounty_value: entryBountyValue(tournament, e)
                }))
                .filter(r => r.knockouts > 0 || r.bounty_winnings > 0)
                .sort((a, b) => b.bounty_winnings - a.bounty_winnings || b.knockouts - a.knockouts)
            : [];
        const totalBountyWinnings = bountyLeaderboard.reduce((s, r) => s + r.bounty_winnings, 0);

        // Payment-method breakdown of ENTRY buy-ins (recorded per entry at
        // registration; entries registered before the column was populated
        // fall under 'unrecorded').
        const paymentBreakdown = {};
        for (const e of nonCancelled) {
            const method = e.payment_method || 'unrecorded';
            if (!paymentBreakdown[method]) paymentBreakdown[method] = { count: 0, amount: 0 };
            paymentBreakdown[method].count += 1;
            paymentBreakdown[method].amount += buyinAmount + buyinFee;
        }

        return res.status(200).json({
            success: true,
            data: {
                tournament_name: tournament?.name,
                tournament_date: tournament?.scheduled_start,
                entries: entries || [],
                summary: {
                    total_entries: totalEntries,
                    total_rebuys: totalRebuys,
                    total_addons: totalAddons,
                    total_revenue: totalRevenue,
                    house_fees: houseFees,
                    prize_pool: prizePool,
                    collected_pool: collectedPool,
                    overlay,
                    buyin_amount: buyinAmount,
                    buyin_fee: buyinFee,
                    payment_breakdown: paymentBreakdown,
                    // Bounty accounting. bounty_pool is collected but held out
                    // of prize_pool; total_bounty_winnings is what has been
                    // paid out of it so far.
                    tournament_type: tournament?.tournament_type || null,
                    bounty_amount: tournament?.bounty_amount || 0,
                    bounty_per_entry: bountyPortionPerEntry(tournament),
                    bounty_pool: bountyPool,
                    total_bounty_winnings: totalBountyWinnings
                },
                bounty_leaderboard: bountyLeaderboard
            }
        });
    } catch (error) {
        console.warn('Registration report error:', error);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }
}

/**
 * Cashier Report - tournament cash reconciliation
 *
 * 2026-08-19: cashier_staff_id and payment_method ARE real columns on
 * commander_tournament_entries (verified against the live schema), and
 * registration writes both, so per-cashier attribution of entry buy-ins is
 * derivable and reported. Entries taken before the columns were populated
 * (or via self-registration) appear under the 'unattributed' bucket.
 */
async function cashierReport(req, res, tournamentId, staff) {
    try {
        const { data: tournament } = await getSupabase()
            .from('commander_tournaments')
            .select('name, venue_id, buyin_amount, buyin_fee, rebuy_amount, addon_amount, scheduled_start')
            .eq('id', tournamentId)
            .maybeSingle();

        if (!tournament) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
        }

        // Venue scope: this report carries player names, payment methods and
        // cashier attribution. See src/lib/commander/venueScope.js.
        if (denyCrossVenue(res, staff, tournament)) return;

        const { data: entries, error } = await getSupabase()
            .from('commander_tournament_entries')
            .select(`
        id, player_name, registration_method, payment_method, cashier_staff_id, status,
        rebuy_count, addon_taken, registered_at,
        profiles (display_name)
      `)
            .eq('tournament_id', tournamentId)
            .order('registered_at', { ascending: true });

        if (error) throw error;

        const buyinAmount = tournament?.buyin_amount || 0;
        const buyinFee = tournament?.buyin_fee || 0;
        const entryTotal = buyinAmount + buyinFee;

        const nonCancelled = (entries || []).filter(e => e.status !== 'cancelled');
        const entryCount = nonCancelled.length;
        const totalRebuys = nonCancelled.reduce((sum, e) => sum + (e.rebuy_count || 0), 0);
        const totalAddons = nonCancelled.filter(e => e.addon_taken).length;

        // Per-cashier split of ENTRY buy-ins (from cashier_staff_id, written by
        // the verified staff session at registration).
        const byCashier = {};
        for (const e of nonCancelled) {
            const key = e.cashier_staff_id || 'unattributed';
            if (!byCashier[key]) {
                byCashier[key] = { cashier_staff_id: e.cashier_staff_id || null, cashier_name: null, entries: 0, collected: 0, by_payment_method: {} };
            }
            byCashier[key].entries += 1;
            byCashier[key].collected += entryTotal;
            const method = e.payment_method || 'unrecorded';
            byCashier[key].by_payment_method[method] = (byCashier[key].by_payment_method[method] || 0) + entryTotal;
        }

        // Resolve cashier display names
        const cashierIds = Object.values(byCashier).map(c => c.cashier_staff_id).filter(Boolean);
        if (cashierIds.length > 0) {
            const { data: staffRows } = await getSupabase()
                .from('commander_staff')
                .select('id, display_name')
                .in('id', cashierIds);
            for (const s of (staffRows || [])) {
                if (byCashier[s.id]) byCashier[s.id].cashier_name = s.display_name || null;
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                tournament_name: tournament?.name,
                tournament_date: tournament?.scheduled_start,
                cashiers: Object.values(byCashier),
                cashier_attribution_available: true,
                reconciliation_note: 'Cashier Attribution Covers Entry Buy-Ins Only. Rebuy And Add-On Cash Is Ledgered In commander_cash_transactions By The Rebuy/Add-On RPCs.',
                total_entries: entryCount,
                total_rebuys: totalRebuys,
                total_addons: totalAddons,
                buyin_amount: buyinAmount,
                buyin_fee: buyinFee,
                total_collected: entryCount * entryTotal,
                total_fees: entryCount * buyinFee,
                // Rebuy and add-on cash is deliberately excluded from
                // total_collected so the number reconciles against the entry
                // drawer; the derivable side totals are exposed separately.
                rebuy_addon_cash_included: false,
                rebuy_collected: totalRebuys * (tournament?.rebuy_amount || 0),
                addon_collected: totalAddons * (tournament?.addon_amount || 0)
            }
        });
    } catch (error) {
        console.warn('Cashier report error:', error);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }
}

/**
 * Activity Report - chronological event log
 * All registrations, eliminations, rebuys with timestamps
 */
async function activityReport(req, res, tournamentId, staff) {
    try {
        // This report read the entry list directly, with no tournament row and
        // therefore no way to tell whose event it was. The load exists solely
        // so the venue can be checked before any player name is returned.
        const { data: tournament } = await getSupabase()
            .from('commander_tournaments')
            .select('id, venue_id')
            .eq('id', tournamentId)
            .maybeSingle();

        if (!tournament) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
        }
        if (denyCrossVenue(res, staff, tournament)) return;

        const { data: entries, error } = await getSupabase()
            .from('commander_tournament_entries')
            .select(`
        id, player_id, player_name, status, table_number, seat_number,
        rebuy_count, addon_taken, finish_position, payout_amount,
        registered_at, eliminated_at, current_chips,
        profiles (display_name, avatar_url)
      `)
            .eq('tournament_id', tournamentId)
            .order('registered_at', { ascending: true })

        if (error) throw error;

        // Build activity timeline
        const activities = [];
        (entries || []).forEach(e => {
            const name = e.profiles?.display_name || e.player_name || 'Unknown';

            // Registration event
            if (e.registered_at) {
                activities.push({
                    type: 'registration',
                    player_name: name,
                    player_id: e.player_id,
                    timestamp: e.registered_at,
                    details: `Registered At Table ${e.table_number || '?'}, Seat ${e.seat_number || '?'}`
                });
            }

            // Elimination event
            if (e.eliminated_at) {
                activities.push({
                    type: 'elimination',
                    player_name: name,
                    player_id: e.player_id,
                    timestamp: e.eliminated_at,
                    details: e.finish_position ? `Finished #${e.finish_position}` : 'Eliminated',
                    payout: e.payout_amount
                });
            }

            // Rebuy events (approximate - we only have count, not individual timestamps)
            if (e.rebuy_count > 0) {
                activities.push({
                    type: 'rebuy',
                    player_name: name,
                    player_id: e.player_id,
                    timestamp: e.registered_at, // Approximate
                    details: `${e.rebuy_count} Rebuy(s)`
                });
            }

            // Add-on event
            if (e.addon_taken) {
                activities.push({
                    type: 'addon',
                    player_name: name,
                    player_id: e.player_id,
                    timestamp: e.registered_at, // Approximate
                    details: 'Add-On Taken'
                });
            }
        });

        // Sort by timestamp descending
        activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return res.status(200).json({
            success: true,
            data: {
                activities,
                total_events: activities.length
            }
        });
    } catch (error) {
        try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
        console.warn('Activity report error:', error);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }
}
