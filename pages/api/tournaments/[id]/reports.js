/**
 * Tournament Reports API
 * GET /api/commander/tournaments/[id]/reports?type=registration|cashier|activity
 * Provides detailed reporting for TD operations
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

      const _staff = await guardStaff(req, res);
      if (!_staff) return;

      if (req.method !== 'GET') {
          return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
      }

      const { id: tournamentId, type } = req.query;

      switch (type) {
          case 'registration': return registrationReport(req, res, tournamentId);
          case 'cashier': return cashierReport(req, res, tournamentId);
          case 'activity': return activityReport(req, res, tournamentId);
          default:
              return res.status(400).json({ success: false, error: { message: 'type required: registration, cashier, or activity' } });
      }

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * Registration Report — per-entry breakdown
 * Player name, seat, buy-in, payment method, cashier, timestamp
 */
async function registrationReport(req, res, tournamentId) {
    try {
        const { data: tournament } = await getSupabase()
            .from('commander_tournaments')
            .select('name, buyin_amount, buyin_fee, scheduled_start')
            .eq('id', tournamentId)
            .maybeSingle();

        const { data: entries, error } = await getSupabase()
            .from('commander_tournament_entries')
            .select(`
        id, player_id, player_name, status, table_number, seat_number,
        registration_method, payment_method, cashier_staff_id,
        rebuy_count, addon_taken, payout_amount, finish_position,
        registered_at, eliminated_at, current_chips,
        profiles (id, display_name, avatar_url)
      `)
            .eq('tournament_id', tournamentId)
            .order('registered_at', { ascending: true });

        if (error) throw error;

        // Calculate summary
        const totalEntries = (entries || []).length;
        const totalRebuys = (entries || []).reduce((sum, e) => sum + (e.rebuy_count || 0), 0);
        const totalAddons = (entries || []).filter(e => e.addon_taken).length;
        const buyinAmount = tournament?.buyin_amount || 0;
        const buyinFee = tournament?.buyin_fee || 0;
        const totalBuyins = totalEntries * (buyinAmount + buyinFee);
        const totalRebuyRevenue = totalRebuys * (buyinAmount); // Rebuys typically don't include fee
        const totalAddonRevenue = totalAddons * (buyinAmount); // Simplified
        const totalRevenue = totalBuyins + totalRebuyRevenue + totalAddonRevenue;
        const houseFees = totalEntries * buyinFee;
        const prizePool = totalRevenue - houseFees;

        // Group by payment method
        const paymentBreakdown = {};
        (entries || []).forEach(e => {
            const method = e.payment_method || 'cash';
            if (!paymentBreakdown[method]) paymentBreakdown[method] = { count: 0, total: 0 };
            paymentBreakdown[method].count += 1;
            paymentBreakdown[method].total += (buyinAmount + buyinFee);
        });

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
                    buyin_amount: buyinAmount,
                    buyin_fee: buyinFee,
                    payment_breakdown: paymentBreakdown
                }
            }
        });
    } catch (error) {
        console.warn('Registration report error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}

/**
 * Cashier Report — per-cashier reconciliation
 * Total entries handled, cash collected, fees, by cashier staff
 */
async function cashierReport(req, res, tournamentId) {
    try {
        const { data: tournament } = await getSupabase()
            .from('commander_tournaments')
            .select('name, buyin_amount, buyin_fee, scheduled_start')
            .eq('id', tournamentId)
            .maybeSingle();

        const { data: entries, error } = await getSupabase()
            .from('commander_tournament_entries')
            .select(`
        id, player_name, payment_method, cashier_staff_id,
        rebuy_count, addon_taken, registered_at,
        profiles (display_name)
      `)
            .eq('tournament_id', tournamentId)
            .order('registered_at', { ascending: true });

        if (error) throw error;

        // Get staff names for cashier IDs
        const cashierIds = [...new Set((entries || []).map(e => e.cashier_staff_id).filter(Boolean))]
        let staffMap = {};
        if (cashierIds.length > 0) {
            // 2026-07-25 audit fix: missing semicolon made the next line parse as
            // a call on the query builder (`.in(...)(staff || [])...`), crashing.
            const { data: staff } = await getSupabase()
                .from('commander_staff')
                .select('id, first_name, last_name')
                .in('id', cashierIds);
            (staff || []).forEach(s => {
                staffMap[s.id] = `${s.first_name || ''} ${s.last_name || ''}`.trim() || 'Unknown';
            });
        }

        const buyinAmount = tournament?.buyin_amount || 0;
        const buyinFee = tournament?.buyin_fee || 0;
        const entryTotal = buyinAmount + buyinFee;

        // Group by cashier
        const cashierBreakdown = {};
        (entries || []).forEach(e => {
            const cashierId = e.cashier_staff_id || 'unassigned';
            const cashierName = staffMap[cashierId] || 'Unassigned';
            if (!cashierBreakdown[cashierId]) {
                cashierBreakdown[cashierId] = {
                    cashier_id: cashierId,
                    cashier_name: cashierName,
                    entries_count: 0,
                    rebuys_count: 0,
                    addons_count: 0,
                    total_cash: 0,
                    total_fees: 0,
                    payment_methods: {}
                };
            }
            const cb = cashierBreakdown[cashierId];
            cb.entries_count += 1;
            cb.rebuys_count += (e.rebuy_count || 0);
            if (e.addon_taken) cb.addons_count += 1;
            cb.total_cash += entryTotal;
            cb.total_fees += buyinFee;

            const method = e.payment_method || 'cash';
            if (!cb.payment_methods[method]) cb.payment_methods[method] = 0;
            cb.payment_methods[method] += entryTotal;
        });

        return res.status(200).json({
            success: true,
            data: {
                tournament_name: tournament?.name,
                tournament_date: tournament?.scheduled_start,
                cashiers: Object.values(cashierBreakdown || {}),
                total_entries: (entries || []).length,
                total_collected: (entries || []).length * entryTotal
            }
        });
    } catch (error) {
        console.warn('Cashier report error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}

/**
 * Activity Report — chronological event log
 * All registrations, eliminations, rebuys with timestamps
 */
async function activityReport(req, res, tournamentId) {
    try {
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
                    details: `Registered at Table ${e.table_number || '?'}, Seat ${e.seat_number || '?'}`
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

            // Rebuy events (approximate — we only have count, not individual timestamps)
            if (e.rebuy_count > 0) {
                activities.push({
                    type: 'rebuy',
                    player_name: name,
                    player_id: e.player_id,
                    timestamp: e.registered_at, // Approximate
                    details: `${e.rebuy_count} rebuy(s)`
                });
            }

            // Add-on event
            if (e.addon_taken) {
                activities.push({
                    type: 'addon',
                    player_name: name,
                    player_id: e.player_id,
                    timestamp: e.registered_at, // Approximate
                    details: 'Add-on taken'
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
        try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
        console.warn('Activity report error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}
