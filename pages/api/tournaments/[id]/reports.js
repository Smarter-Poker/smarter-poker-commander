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

        // 2026-07-28 audit fix: commander_tournament_entries has no
        // payment_method and no cashier_staff_id column. PostgREST rejected the
        // whole select with 42703, so this report returned HTTP 500 on every call.
        const { data: entries, error } = await getSupabase()
            .from('commander_tournament_entries')
            .select(`
        id, player_id, player_name, status, table_number, seat_number,
        registration_method,
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

        // Payment-method breakdown is NOT derivable: nothing on
        // commander_tournament_entries records how an entry was tendered, and the
        // tournament buy-in rows written to commander_cash_transactions carry no
        // tournament_id to join back on. Reporting it as all-cash would be a
        // fabricated money figure, so it is returned as null instead.

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
                    payment_breakdown: null,
                    payment_breakdown_note: 'Not recorded: commander_tournament_entries has no payment_method column.'
                }
            }
        });
    } catch (error) {
        console.warn('Registration report error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}

/**
 * Cashier Report — tournament cash reconciliation
 *
 * 2026-07-28 audit fix: this report used to select payment_method and
 * cashier_staff_id from commander_tournament_entries. Neither column exists, so
 * PostgREST returned 42703 and the endpoint answered HTTP 500 on every call — a
 * cash control that looked present but caught nothing.
 *
 * The per-cashier split cannot be restored from the current schema: no table
 * attributes a tournament entry to the staff member who took the money.
 * commander_cash_transactions does carry processed_by, but the buy-in rows it
 * receives from tournament registration have no tournament_id — only a free-text
 * note — so they cannot be joined back to a tournament reliably. Rather than
 * invent an attribution, the report now returns the tournament-level totals that
 * ARE derivable and flags cashier attribution as unavailable.
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
        id, player_name, registration_method,
        rebuy_count, addon_taken, registered_at,
        profiles (display_name)
      `)
            .eq('tournament_id', tournamentId)
            .order('registered_at', { ascending: true });

        if (error) throw error;

        const buyinAmount = tournament?.buyin_amount || 0;
        const buyinFee = tournament?.buyin_fee || 0;
        const entryTotal = buyinAmount + buyinFee;

        const entryCount = (entries || []).length;
        const totalRebuys = (entries || []).reduce((sum, e) => sum + (e.rebuy_count || 0), 0);
        const totalAddons = (entries || []).filter(e => e.addon_taken).length;

        return res.status(200).json({
            success: true,
            data: {
                tournament_name: tournament?.name,
                tournament_date: tournament?.scheduled_start,
                // No cashier attribution exists in the schema — see the note above.
                // An empty list is returned deliberately; the UI renders
                // "No cashier data recorded" rather than a fabricated breakdown.
                cashiers: [],
                cashier_attribution_available: false,
                reconciliation_note: 'Per-cashier attribution is not recorded: commander_tournament_entries has no cashier_staff_id or payment_method column. Tournament-level totals below are derived from the tournament buy-in and fee.',
                total_entries: entryCount,
                total_rebuys: totalRebuys,
                total_addons: totalAddons,
                buyin_amount: buyinAmount,
                buyin_fee: buyinFee,
                total_collected: entryCount * entryTotal,
                total_fees: entryCount * buyinFee,
                // Rebuy and add-on cash is deliberately excluded from
                // total_collected: it is not derivable whether rebuy_amount /
                // addon_amount are tendered with or without the house fee, and
                // this figure is reconciled against a physical drawer.
                rebuy_addon_cash_included: false
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
