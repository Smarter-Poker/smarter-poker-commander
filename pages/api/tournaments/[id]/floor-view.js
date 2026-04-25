/**
 * Floor View API
 * GET /api/commander/tournaments/[id]/floor-view
 * Returns complete tournament state for the TD Tablet:
 * - Tournament info + clock state
 * - All tables with player counts and balance status
 * - All seated players with chip counts
 * - Imbalance alerts
 * - Stats (entries, rebuys, addons, prize pool, avg stack)
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { parseBlindStructure } from '../../../../src/lib/parseBlindStructure';
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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Tournament ID required' });

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament with full details
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });


      // Get ALL entries (active + eliminated + registered) - Up to 5000 to prevent cutoff on massive fields
      const { data: allEntries } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('table_number', { ascending: true })
        .order('seat_number', { ascending: true })
        .limit(5000);

      const entries = allEntries || [];
      const activeEntries = entries.filter(e => ['active', 'seated'].includes(e.status));
      const eliminatedEntries = entries.filter(e => e.status === 'eliminated');
      const registeredEntries = entries.filter(e => e.status === 'registered');

      // Batch fetch profile avatars for linked players
      const avatarMap = {};
      const playerIds = [...new Set(entries.map(e => e.player_id).filter(Boolean))];
      if (playerIds.length > 0) {
        const { data: profiles } = await getSupabase()
          .from('profiles')
          .select('id, avatar_url, display_name')
              .limit(500)
          .in('id', playerIds);
        if (profiles) {
          profiles.forEach(p => { avatarMap[p.id] = { avatar_url: p.avatar_url, display_name: p.display_name }; });
        }
      }

      // Build table map — get real max_seats from commander_tables
      const tableNumbers = [...new Set(activeEntries.map(e => e.table_number).filter(Boolean))].sort((a, b) => a - b);

      // Query actual table configs for max_seats
      let tableConfigs = {};
      if (tableNumbers.length > 0) {
        const { data: dbTables } = await getSupabase()
          .from('commander_tables')
          .select('table_number, max_seats')
          .eq('venue_id', tournament.venue_id)
          .in('table_number', tableNumbers)
              .limit(100)
        if (dbTables) {
          dbTables.forEach(t => { tableConfigs[t.table_number] = t.max_seats || 9; });
        }
      }

      const tableCounts = {};
      tableNumbers.forEach(tn => { tableCounts[tn] = 0; });
      activeEntries.forEach(e => {
        if (e.table_number) tableCounts[e.table_number] = (tableCounts[e.table_number] || 0) + 1;
      });

      const countValues = Object.values(tableCounts || {});
      const maxCount = countValues.length > 0 ? Math.max(...countValues) : 0;
      const minCount = countValues.length > 0 ? Math.min(...countValues) : 0;

      const tables = tableNumbers.map(tn => {
        const maxSeats = tableConfigs[tn] || 9;
        const players = activeEntries
          .filter(e => e.table_number === tn)
          .map(e => ({
            entry_id: e.id,
            player_name: avatarMap[e.player_id]?.display_name || e.player_name,
            seat_number: e.seat_number,
            current_chips: e.current_chips,
            rebuy_count: e.rebuy_count || 0,
            addon_taken: e.addon_taken || false,
            locked: e.metadata?.locked_seat || false,
            avatar_url: avatarMap[e.player_id]?.avatar_url || null
          }));

        const count = tableCounts[tn];
        let color = 'green';
        if (count === 0) color = 'grey';
        else if (maxCount - count >= 2) color = 'red';
        else if (maxCount - count === 1) color = 'yellow';
        if (tournament.status === 'final_table') color = 'blue';

        return {
          table_number: tn,
          player_count: count,
          max_seats: maxSeats,
          available_seats: maxSeats - count,
          color,
          players
        };
      });

      // Calculate stats
      const totalRebuys = entries.reduce((sum, e) => sum + (e.rebuy_count || 0), 0);
      const totalAddons = entries.filter(e => e.addon_taken).length;
      const totalChips = activeEntries.reduce((sum, e) => sum + (e.current_chips || 0), 0);
      const avgStack = activeEntries.length > 0 ? Math.round(totalChips / activeEntries.length) : 0;
      const prizePool = tournament.actual_prizepool || tournament.prize_pool ||
        (entries.length * (tournament.buyin_amount || 0)) +
        (totalRebuys * (tournament.rebuy_cost || 0)) +
        (totalAddons * (tournament.addon_cost || 0));

      // Check late registration
      const lateRegOpen = tournament.status === 'running' &&
        (tournament.current_level || 0) <= (tournament.late_registration_levels || 0);

      // Imbalance check
      const imbalanced = tableNumbers.length >= 2 && (maxCount - minCount >= 2);
      const avgMaxSeats = tableNumbers.length > 0
        ? Math.round(tableNumbers.reduce((sum, tn) => sum + (tableConfigs[tn] || 9), 0) / tableNumbers.length)
        : 9;
      const canBreakTable = tableNumbers.length > Math.ceil(activeEntries.length / avgMaxSeats);

      // Clock info
      const blindStructure = parseBlindStructure(tournament.blind_structure);
      const currentLevel = tournament.current_level || 0;
      const currentBlinds = blindStructure[currentLevel] || {};
      const nextBlinds = blindStructure[currentLevel + 1] || null;

      // If the next level is a break, find the first normal play level after it
      let afterBreakBlinds = null;
      if (nextBlinds && nextBlinds.is_break) {
        for (let i = currentLevel + 2; i < blindStructure.length; i++) {
          if (!blindStructure[i].is_break) {
            afterBreakBlinds = blindStructure[i];
            break;
          }
        }
      }

      // Compute remaining_seconds dynamically (mirrors clock.js logic)
      let remaining_seconds = 0;
      const tournamentSettings = tournament.settings || {};
      let clockState = tournamentSettings.clock_state || null;

      // Auto-initialize clock_state for running tournaments that were never properly started
      if (!clockState && ['running', 'break', 'final_table'].includes(tournament.status)) {
        clockState = {
          isRunning: tournament.status === 'running',
          levelStartedAt: tournament.actual_start || tournament.scheduled_start || new Date().toISOString(),
          pausedAt: null,
          pausedDuration: 0
        };
        // Persist so this only happens once — store in settings to bypass schema cache issues
        const updatedSettings = { ...tournamentSettings, clock_state: clockState };
        await getSupabase()
          .from('commander_tournaments')
          .update({ settings: updatedSettings, actual_start: clockState.levelStartedAt })
          .eq('id', tournamentId);
      }

      if (currentBlinds && currentBlinds.duration && clockState && clockState.levelStartedAt) {
        const levelDuration = currentBlinds.duration * 60 * 1000;
        const elapsed = clockState.isRunning
          ? Date.now() - new Date(clockState.levelStartedAt).getTime() - (clockState.pausedDuration || 0)
          : clockState.pausedAt
            ? new Date(clockState.pausedAt).getTime() - new Date(clockState.levelStartedAt).getTime() - (clockState.pausedDuration || 0)
            : 0;
        remaining_seconds = Math.max(0, Math.floor((levelDuration - elapsed) / 1000));
      }

      return res.status(200).json({
        success: true,
        data: {
          tournament: {
            id: tournament.id,
            venue_id: tournament.venue_id,
            name: tournament.name,
            status: tournament.status,
            tournament_type: tournament.tournament_type,
            buyin_amount: tournament.buyin_amount,
            buyin_fee: tournament.buyin_fee,
            starting_chips: tournament.starting_chips,
            allows_rebuys: tournament.allows_rebuys,
            rebuy_cost: tournament.rebuy_cost,
            rebuy_chips: tournament.rebuy_chips,
            rebuy_levels: tournament.rebuy_levels,
            rebuy_end_level: tournament.rebuy_end_level,
            allows_addon: tournament.allows_addon,
            addon_cost: tournament.addon_cost,
            addon_chips: tournament.addon_chips,
            late_registration_levels: tournament.late_registration_levels,
            guaranteed_pool: tournament.guaranteed_pool,
            started_at: tournament.actual_start || tournament.started_at,
            actual_start: tournament.actual_start,
            scheduled_start: tournament.scheduled_start,
            game_type: tournament.game_type,
            payout_structure: tournament.payout_structure,
            custom_payouts: tournament.custom_payouts,
            clock_color: tournament.settings?.clock_color,
            max_entries: tournament.max_entries,
            blind_structure: blindStructure,
            settings: tournament.settings || {},
          },
          clock: {
            current_level: currentLevel,
            current_blinds: currentBlinds,
            next_blinds: nextBlinds,
            after_break_blinds: afterBreakBlinds,
            clock_state: {
              ...(clockState || {}),
              remaining_seconds,
              status: clockState?.isRunning ? 'running' : 'paused',
              started_at: tournament.actual_start,
            },
            total_levels: blindStructure.length
          },
          stats: {
            total_entries: entries.length,
            players_remaining: activeEntries.length,
            players_eliminated: eliminatedEntries.length,
            players_registered: registeredEntries.length,
            total_rebuys: totalRebuys,
            total_addons: totalAddons,
            prize_pool: prizePool,
            total_chips: totalChips,
            average_stack: avgStack,
            tables_active: tableNumbers.length,
            late_reg_open: lateRegOpen,
            levels_until_late_reg_closes: lateRegOpen
              ? (tournament.late_registration_levels || 0) - currentLevel
              : 0,
            // True once the re-entry window closes — signals that auto-break is now active
            re_entry_period_over: currentLevel > Math.max(
              tournament.rebuy_levels || 0,
              tournament.late_registration_levels || 0
            ),

            player_stacks: activeEntries
              .filter(e => e.current_chips > 0)
              .map(e => ({ name: avatarMap[e.player_id]?.display_name || e.player_name, chips: e.current_chips }))
          },
          alerts: {
            imbalanced,
            can_break_table: canBreakTable,
            hand_for_hand: clockState?.hand_for_hand || false,
            on_break: clockState?.on_break || false
          },
          tables,
          // Full entries list for Players tab — includes ALL statuses
          entries: entries.map(e => ({
            entry_id: e.id,
            player_name: avatarMap[e.player_id]?.display_name || e.player_name,
            user_id: e.user_id,
            status: e.status,
            table_number: e.table_number,
            seat_number: e.seat_number,
            current_chips: e.current_chips,
            starting_chips: e.starting_chips || tournament.starting_chips,
            rebuy_count: e.rebuy_count || 0,
            addon_taken: e.addon_taken || false,
            finish_position: e.finish_position,
            eliminated_at: e.eliminated_at,
            payout_amount: e.payout_amount,
            registered_at: e.created_at,
            phone: e.phone,
            metadata: e.metadata,
            avatar_url: avatarMap[e.player_id]?.avatar_url || null,
          })),
          eliminated: eliminatedEntries
            .sort((a, b) => (b.finish_position || 999) - (a.finish_position || 999))
            .slice(0, 20)
            .map(e => ({
              entry_id: e.id,
              player_name: avatarMap[e.player_id]?.display_name || e.player_name,
              finish_position: e.finish_position,
              eliminated_at: e.eliminated_at,
              payout_amount: e.payout_amount
            }))
        }
      });
    } catch (err) {
      console.warn('Floor view error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
