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
import { guardStaff } from '../../../../src/lib/commander/auth';
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

// Hot path. Every TD screen and every table tablet polls this route, so it
// selects columns instead of `*`: the tournament row carries break_schedule,
// day_end_chip_counts and a dozen multi-day columns nothing here reads, and an
// entry row carries cashier/payment/notes columns that never reach the client.
const TOURNAMENT_COLUMNS = [
  'id', 'venue_id', 'name', 'status', 'tournament_type', 'buyin_amount', 'buyin_fee',
  'starting_chips', 'allows_rebuys', 'rebuy_amount', 'rebuy_chips', 'rebuy_end_level',
  'allows_addon', 'addon_amount', 'addon_chips', 'late_registration_levels',
  'guaranteed_pool', 'actual_start', 'scheduled_start', 'payout_structure',
  'bounty_amount', 'actual_prizepool', 'paying_places', 'max_entries',
  'blind_structure', 'settings', 'current_level'
].join(', ');

const ENTRY_COLUMNS = [
  'id', 'player_id', 'player_name', 'status', 'table_number', 'seat_number',
  'current_chips', 'rebuy_count', 'addon_taken', 'finish_position', 'eliminated_at',
  'payout_amount', 'registered_at', 'created_at', 'metadata'
].join(', ');

// Clock backfill throttle. A tournament that was never properly started has no
// settings.clock_state, and this GET used to write one on EVERY request. With
// 20 tablets polling that is 40 writes a minute, and because
// commander_clock_write stamps levelStartedAt = now() unconditionally, each of
// those writes restarted the level timer - the clock could never run down.
// The write is now memoised per process AND guarded at the database level, so
// only the first caller in the room actually persists anything.
const CLOCK_BACKFILL_TTL_MS = 60 * 1000;
const _clockBackfillAt = new Map();
function claimClockBackfill(tournamentId) {
  const now = Date.now();
  const last = _clockBackfillAt.get(tournamentId);
  if (last && now - last < CLOCK_BACKFILL_TTL_MS) return false;
  // Bound the map so a long-lived instance cannot leak across many events.
  if (_clockBackfillAt.size > 500) _clockBackfillAt.clear();
  _clockBackfillAt.set(tournamentId, now);
  return true;
}

// Auth: STAFF READ. guardWriteStaff left this GET fully public, which exposed
// player names, phones, chip counts and entry metadata to anyone with the URL.
// guardStaff requires a valid signed staff session on every method.
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const _g = await guardStaff(req, res); if (!_g) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Tournament ID required' });

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // The tournament row and the entries list depend only on the id, so they
      // go out together. Serialising them cost a full network round trip to
      // Supabase on every poll from every device for no reason.
      const [tournamentRes, entriesRes] = await Promise.all([
        getSupabase()
          .from('commander_tournaments')
          .select(TOURNAMENT_COLUMNS)
          .eq('id', tournamentId)
          .maybeSingle(),
        // Get ALL entries (active + eliminated + registered) - Up to 5000 to prevent cutoff on massive fields
        getSupabase()
          .from('commander_tournament_entries')
          .select(ENTRY_COLUMNS)
          .eq('tournament_id', tournamentId)
          .order('table_number', { ascending: true })
          .order('seat_number', { ascending: true })
          .limit(5000)
      ]);

      const { data: tournament, error: tErr } = tournamentRes;
      if (tErr || !tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });

      const entries = entriesRes.data || [];
      const activeEntries = entries.filter(e => ['active', 'seated'].includes(e.status));
      const eliminatedEntries = entries.filter(e => e.status === 'eliminated');
      const registeredEntries = entries.filter(e => e.status === 'registered');

      // Build table map - get real max_seats from commander_tables
      const tableNumbers = [...new Set(activeEntries.map(e => e.table_number).filter(Boolean))].sort((a, b) => a - b);

      // Avatars and table configs are independent of each other, so the second
      // pair of lookups also goes out together. Four serial round trips on the
      // busiest route in the room is now two.
      const playerIds = [...new Set(entries.map(e => e.player_id).filter(Boolean))];
      const [profilesRes, dbTablesRes] = await Promise.all([
        playerIds.length > 0
          ? getSupabase()
              .from('profiles')
              .select('id, avatar_url, display_name')
              .limit(500)
              .in('id', playerIds)
          : Promise.resolve({ data: null }),
        tableNumbers.length > 0
          ? getSupabase()
              .from('commander_tables')
              .select('table_number, max_seats')
              .eq('venue_id', tournament.venue_id)
              .in('table_number', tableNumbers)
              .limit(100)
          : Promise.resolve({ data: null })
      ]);

      // Batch fetch profile avatars for linked players
      const avatarMap = {};
      if (profilesRes.data) {
        profilesRes.data.forEach(p => { avatarMap[p.id] = { avatar_url: p.avatar_url, display_name: p.display_name }; });
      }

      // Query actual table configs for max_seats
      const tableConfigs = {};
      if (dbTablesRes.data) {
        dbTablesRes.data.forEach(t => { tableConfigs[t.table_number] = t.max_seats || 9; });
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
            // Omitted rather than null when there is no linked profile: every
            // consumer tests truthiness, and a null per seat is dead weight on
            // a 500 seat field polled by the whole room.
            avatar_url: avatarMap[e.player_id]?.avatar_url || undefined
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
      // 2026-07-25 audit fix: rebuy_cost/addon_cost are not real columns,
      // use rebuy_amount/addon_amount so rebuys and add-ons count in the pool.
      // 2026-08-19 fix: dropped the dead tournament.prize_pool read (not a column)
      // and applied the guarantee: the advertised pool is max(collected, guarantee),
      // TableCaptain-style, so overlays display correctly.
      // Cancelled entries never paid (their money row is reversed), so they
      // must not count toward the pool. Alternates DID pay at sign-up.
      const paidEntryCount = entries.filter(e => e.status !== 'cancelled').length;
      const collectedPool = (paidEntryCount * (tournament.buyin_amount || 0)) +
        (totalRebuys * (tournament.rebuy_amount || 0)) +
        (totalAddons * (tournament.addon_amount || 0));
      const prizePool = tournament.actual_prizepool ||
        Math.max(collectedPool, tournament.guaranteed_pool || 0);
      const overlayAmount = Math.max(0, (tournament.guaranteed_pool || 0) - collectedPool);

      // Check late registration.
      // 2026-08-20 fix: this used current_level <= late_registration_levels
      // while register.js and entries.js close registration when
      // (current_level + 1) > late_registration_levels. The two disagreed by a
      // full level, so the console advertised late reg as OPEN for a level in
      // which the registration endpoints were already rejecting players, and
      // the cashier only found out when the buy-in bounced.
      const lateRegLevels = tournament.late_registration_levels || 0;
      const currentLevelNumber = (tournament.current_level || 0) + 1;
      const lateRegOpen = tournament.status === 'running' &&
        currentLevelNumber <= lateRegLevels;

      // Seat conflicts: two live players holding the same table + seat. The
      // floor has to know, otherwise the first the room hears about it is two
      // players arguing over one chair. Historic data contains these, and the
      // read-then-write seating path that created them is now atomic.
      const seatOwners = new Map();
      const seatConflicts = [];
      for (const e of activeEntries) {
        if (!e.table_number || !e.seat_number) continue;
        const key = `${e.table_number}:${e.seat_number}`;
        if (seatOwners.has(key)) {
          seatConflicts.push({
            table_number: e.table_number,
            seat_number: e.seat_number,
            players: [seatOwners.get(key), avatarMap[e.player_id]?.display_name || e.player_name].filter(Boolean)
          });
        } else {
          seatOwners.set(key, avatarMap[e.player_id]?.display_name || e.player_name);
        }
      }

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
        // 2026-07-25 audit fix: when backfilling mid-tournament use now as
        // levelStartedAt - using actual_start made the level appear long expired.
        clockState = {
          isRunning: tournament.status === 'running',
          levelStartedAt: new Date().toISOString(),
          pausedAt: null,
          pausedDuration: 0
        };
        // Persist so this only happens once. Two guards, because this is a GET
        // that 20 tablets hit every 30 seconds:
        //   1. claimClockBackfill throttles a warm instance to one attempt per
        //      tournament per minute.
        //   2. The UPDATE carries `settings->>clock_state is null`, so a second
        //      instance racing the first writes zero rows instead of stamping a
        //      fresh levelStartedAt and restarting the level timer. The text
        //      arrow is deliberate: `->` would miss a stored JSON null (which
        //      is what the clock `end` action leaves behind), `->>` treats a
        //      missing key and a JSON null alike.
        // The read never depends on the write: clockState is already computed
        // locally, so a failed backfill degrades to "try again next poll".
        if (claimClockBackfill(tournamentId)) {
          try {
            const patch = {
              settings: { ...tournamentSettings, clock_state: clockState },
              ...(tournament.actual_start ? {} : { actual_start: clockState.levelStartedAt })
            };
            const { error: guardErr } = await getSupabase()
              .from('commander_tournaments')
              .update(patch)
              .eq('id', tournamentId)
              .is('settings->>clock_state', null);
            // Fallback for any PostgREST build that will not filter on a jsonb
            // path: the RPC is unguarded but still correct for a single writer.
            if (guardErr) {
              await getSupabase().rpc('commander_clock_write', {
                p_tournament_id: tournamentId,
                p_clock_state: clockState,
                p_updates: tournament.actual_start ? {} : { actual_start: clockState.levelStartedAt }
              });
            }
          } catch (backfillErr) {
            console.warn('[floor-view] Clock backfill skipped:', backfillErr?.message || backfillErr);
          }
        }
      }

      // 2026-08-19 fix: accept duration_minutes as well as duration (clock.js
      // already did; this route returning 0 made every TD screen show 0:00).
      const currentLevelMinutes = currentBlinds
        ? (currentBlinds.duration ?? currentBlinds.duration_minutes ?? 0)
        : 0;
      if (currentLevelMinutes > 0 && clockState && clockState.levelStartedAt) {
        const levelDuration = currentLevelMinutes * 60 * 1000;
        const elapsed = clockState.isRunning
          ? Date.now() - new Date(clockState.levelStartedAt).getTime() - (clockState.pausedDuration || 0)
          : clockState.pausedAt
            ? new Date(clockState.pausedAt).getTime() - new Date(clockState.levelStartedAt).getTime() - (clockState.pausedDuration || 0)
            : 0;
        remaining_seconds = Math.max(0, Math.floor((levelDuration - elapsed) / 1000));
      }

      // Queue order for waiting alternates (first registered is next up).
      const alternateQueue = entries
        .filter(e => e.status === 'alternate')
        .sort((a, b) =>
          new Date(a.registered_at || a.created_at || 0) - new Date(b.registered_at || b.created_at || 0));
      const alternatePositions = new Map(alternateQueue.map((e, i) => [e.id, i + 1]));

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
            // 2026-07-25 audit fix: alias keys kept for clients, sourced from real columns
            rebuy_cost: tournament.rebuy_amount,
            rebuy_chips: tournament.rebuy_chips,
            rebuy_levels: tournament.rebuy_end_level,
            rebuy_end_level: tournament.rebuy_end_level,
            allows_addon: tournament.allows_addon,
            addon_cost: tournament.addon_amount,
            addon_chips: tournament.addon_chips,
            late_registration_levels: tournament.late_registration_levels,
            guaranteed_pool: tournament.guaranteed_pool,
            started_at: tournament.actual_start,
            actual_start: tournament.actual_start,
            scheduled_start: tournament.scheduled_start,
            // commander_tournaments has no game_type column (the variant lives
            // in `variant`), so this has always serialised as absent. Left in
            // place so the column projection above is not blamed for it.
            game_type: tournament.game_type,
            payout_structure: tournament.payout_structure,
            custom_payouts: tournament.payout_structure,
            bounty_amount: tournament.bounty_amount,
            actual_prizepool: tournament.actual_prizepool,
            paying_places: tournament.paying_places,
            clock_color: tournament.settings?.clock_color,
            max_entries: tournament.max_entries,
            blind_structure: blindStructure,
            settings: tournament.settings || {},
          },
          clock: {
            current_level: currentLevel,
            // Break rows share the array with playing levels, so the index is not
            // the level number. display_level counts playing levels only.
            display_level: (() => {
              let n = 0;
              for (let i = 0; i <= currentLevel && i < blindStructure.length; i++) {
                if (!blindStructure[i]?.is_break) n++;
              }
              return n;
            })(),
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
            total_entries: paidEntryCount,
            players_remaining: activeEntries.length,
            players_eliminated: eliminatedEntries.length,
            players_registered: registeredEntries.length,
            players_alternate: entries.filter(e => e.status === 'alternate').length,
            total_rebuys: totalRebuys,
            total_addons: totalAddons,
            prize_pool: prizePool,
            collected_pool: collectedPool,
            overlay_amount: overlayAmount,
            total_chips: totalChips,
            average_stack: avgStack,
            tables_active: tableNumbers.length,
            late_reg_open: lateRegOpen,
            // Levels of late reg left INCLUDING the one being played: at level
            // number N with a cutoff of L there are (L - N + 1) left, which is
            // 1 during the final late-reg level and 0 once it closes. The old
            // form used the raw array index and read one level high.
            levels_until_late_reg_closes: lateRegOpen
              ? Math.max(0, lateRegLevels - currentLevelNumber + 1)
              : 0,
            // True once the re-entry window closes - signals that auto-break is now active
            re_entry_period_over: currentLevelNumber > Math.max(
              tournament.rebuy_end_level || 0,
              lateRegLevels
            ),

            player_stacks: activeEntries
              .filter(e => e.current_chips > 0)
              .map(e => ({ name: avatarMap[e.player_id]?.display_name || e.player_name, chips: e.current_chips }))
          },
          alerts: {
            imbalanced,
            can_break_table: canBreakTable,
            hand_for_hand: clockState?.hand_for_hand || false,
            on_break: clockState?.on_break || false,
            seat_conflicts: seatConflicts
          },
          tables,
          // Waiting alternates in queue order, so the floor can see who is
          // next up and tell a player their position without guessing.
          alternates: alternateQueue.map((e, i) => ({
            entry_id: e.id,
            player_name: avatarMap[e.player_id]?.display_name || e.player_name,
            queue_position: i + 1
          })),
          // Full entries list for Players tab - includes ALL statuses.
          // Deliberately narrow: a 500 player field is serialised here every 30
          // seconds for every tablet and TV in the room. player_phone and the
          // metadata jsonb blob were shipped to every unattended kiosk and read
          // by nothing, and starting_chips was only ever the tournament default
          // repeated once per row (consumers read tournament.starting_chips).
          entries: entries.map(e => ({
            entry_id: e.id,
            player_name: avatarMap[e.player_id]?.display_name || e.player_name,
            user_id: e.player_id,
            status: e.status,
            table_number: e.table_number,
            seat_number: e.seat_number,
            current_chips: e.current_chips,
            rebuy_count: e.rebuy_count || 0,
            addon_taken: e.addon_taken || false,
            finish_position: e.finish_position,
            eliminated_at: e.eliminated_at,
            payout_amount: e.payout_amount,
            registered_at: e.registered_at || e.created_at,
            queue_position: alternatePositions.get(e.id),
            avatar_url: avatarMap[e.player_id]?.avatar_url || undefined,
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
