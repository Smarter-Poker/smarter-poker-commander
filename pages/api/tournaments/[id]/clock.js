/**
 * Tournament Clock API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 3
 * GET /api/commander/tournaments/[id]/clock - Get clock state
 * POST /api/commander/tournaments/[id]/clock - Clock actions (start, pause, resume, next_level, etc.)
 *
 * Clock state is persisted in the tournament row (clock_state JSONB column)
 * so it survives server restarts and works across multiple instances.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import {
  sendPushNotification,
  isOneSignalConfigured
} from '../../../../src/lib/commander/pushNotifications';
import { checkAndExecuteAutoBreak } from '../../../../src/lib/commander/tournamentAutoBreak';
import { logAction } from '../../../../src/lib/commander/audit';
// Shared payout math so the public Payouts tab always matches the TD screen.
import {
  generatePayoutTable,
  normalizePayoutSlot,
  effectivePrizePool,
  allocateAmounts
} from './payout';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

// Inlined to avoid a broken CJS re-export shim (src/lib/parseBlindStructure ->
// @smarter-poker/commander-shared) that resolved to undefined at runtime and
// 500'd this route. Normalises a JSONB blind_structure (array or JSON string)
// to an array of level objects.
function parseBlindStructure(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.length > 0) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch (_e) { /* not JSON */ }
  }
  return [];
}

// Display level number for a structure row. Break rows are interleaved in the
// same array as playing levels, so the array index is NOT the level number.
// Counts only non-break rows up to and including the given index.
function displayLevelNumber(structure, index) {
  let n = 0;
  for (let i = 0; i <= index && i < structure.length; i++) {
    if (!structure[i]?.is_break) n++;
  }
  return n;
}

// Fields inside settings.clock_state that this route does NOT own. They are
// written by hand-for-hand.js, message.js and the break toggle, all of which
// merge. Every timer action here rebuilds clockState from scratch, and
// commander_clock_write does jsonb_set on the WHOLE clock_state object, so a
// single Pause or Next Level used to wipe the hand-for-hand flag, the floor
// announcement banner and the on-break state off the displays.
const CARRIED_CLOCK_FIELDS = [
  'hand_for_hand',
  'hand_for_hand_started_at',
  'messages',
  'current_message',
  'on_break',
  'break_started_at'
];


let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: GET is PUBLIC (live clock page); POST clock actions require STAFF_WRITE.
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const { id: tournamentId } = req.query;

    if (!tournamentId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Tournament ID required' }
      });
    }

    if (req.method === 'GET') {
      return getClockState(req, res, tournamentId);
    }

    if (req.method === 'POST') {
      // Clock actions remain staff-gated.
      const _g = await guardWriteStaff(req, res); if (!_g) return;
      return handleClockAction(req, res, tournamentId, _g);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
    });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getClockState(req, res, tournamentId) {
  try {
    const { data: tournament, error } = await getSupabase()
      .from('commander_tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();

    if (error || !tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament not found' }
      });
    }

    const blindStructure = parseBlindStructure(tournament.blind_structure);
    const currentLevel = tournament.current_level || 0;
    const currentBlind = blindStructure[currentLevel] || null;

    // Read persisted clock state from the settings JSONB (not the clock_state column which has schema cache issues)
    const settings = tournament.settings || {};
    let clockState = settings.clock_state || null;

    if (!clockState && ['running', 'paused', 'final_table'].includes(tournament.status)) {
      // Initialize clock state and persist it
      // 2026-07-25 audit fix: when backfilling mid-tournament use now, not
      // actual_start - actual_start would make the current level appear expired.
      clockState = {
        isRunning: true,
        levelStartedAt: new Date().toISOString(),
        pausedAt: null,
        pausedDuration: 0
      };
      // Atomic jsonb_set on settings.clock_state so a concurrent settings write
      // from another tablet is never clobbered by this backfill.
      await getSupabase().rpc('commander_clock_write', {
        p_tournament_id: tournamentId,
        p_clock_state: clockState
      });
    }

    // Calculate time remaining in level
    let timeRemaining = 0;
    if (currentBlind && clockState) {
      const levelDuration = (currentBlind.duration ?? currentBlind.duration_minutes ?? 0) * 60 * 1000; // Convert to ms
      const elapsed = clockState.isRunning
        ? Date.now() - new Date(clockState.levelStartedAt).getTime() - clockState.pausedDuration
        : clockState.pausedAt
          ? new Date(clockState.pausedAt).getTime() - new Date(clockState.levelStartedAt).getTime() - clockState.pausedDuration
          : 0;

      timeRemaining = Math.max(0, levelDuration - elapsed);
    }

    const nextBlind = blindStructure[currentLevel + 1] || null;

    // Optional public live-event data (TableCaptain live page parity):
    // ?include=chips,payouts adds per-player chip counts and the live payout
    // table. This is intentionally public display data, name, table, seat and
    // stack only. No phones, ids, or metadata.
    const include = String(req.query.include || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    let publicChips;
    let publicPayouts;

    if (include.includes('chips') || include.includes('payouts')) {
      const { data: allEntries } = await getSupabase()
        .from('commander_tournament_entries')
        .select('player_name, status, table_number, seat_number, current_chips, rebuy_count, addon_taken, finish_position, payout_amount')
        .eq('tournament_id', tournamentId)
        .neq('status', 'cancelled')
        .limit(5000);
      const entries = allEntries || [];

      if (include.includes('chips')) {
        publicChips = {
          updated_at: tournament.updated_at,
          players: entries
            .filter(e => ['seated', 'active'].includes(e.status))
            .sort((a, b) => (b.current_chips || 0) - (a.current_chips || 0))
            .map(e => ({
              player_name: e.player_name || 'Player',
              table_number: e.table_number,
              seat_number: e.seat_number,
              chips: e.current_chips || 0
            }))
        };
      }

      if (include.includes('payouts')) {
        const totalRebuys = entries.reduce((s, e) => s + (e.rebuy_count || 0), 0);
        const totalAddons = entries.filter(e => e.addon_taken).length;
        const collected = (entries.length * (tournament.buyin_amount || 0)) +
          (totalRebuys * (tournament.rebuy_amount || 0)) +
          (totalAddons * (tournament.addon_amount || 0));
        const pool = effectivePrizePool(tournament, collected);

        // Deal overrides win; otherwise the saved structure; otherwise the
        // standard field-size-band table.
        let table;
        if (Array.isArray(tournament.final_payouts) && tournament.final_payouts.length > 0) {
          table = tournament.final_payouts.map((p, i) => ({
            position: p.position || i + 1,
            amount: Math.round(Number(p.amount) || 0)
          }));
        } else {
          let slots = Array.isArray(tournament.payout_structure)
            ? tournament.payout_structure.map(normalizePayoutSlot)
            : [];
          if (slots.length === 0) slots = generatePayoutTable(entries.length, tournament.paying_places);
          const amounts = allocateAmounts(slots, pool);
          table = slots.map((s, i) => ({
            position: s.position || i + 1,
            percentage: s.percentage,
            amount: s.amount != null && !s.percentage ? Math.round(Number(s.amount)) : amounts[i]
          }));
        }

        publicPayouts = {
          prize_pool: pool,
          collected_pool: collected,
          overlay_amount: Math.max(0, (tournament.guaranteed_pool || 0) - collected),
          guaranteed_pool: tournament.guaranteed_pool || 0,
          is_deal: Array.isArray(tournament.final_payouts) && tournament.final_payouts.length > 0,
          places: table
        };
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        tournament: {
          id: tournament.id,
          venue_id: tournament.venue_id,
          name: tournament.name,
          status: tournament.status,
          current_level: currentLevel,
          current_entries: tournament.current_entries,
          players_remaining: tournament.players_remaining,
          average_stack: tournament.average_stack,
          total_chips_in_play: tournament.total_chips_in_play
        },
        clock: {
          isRunning: clockState?.isRunning || false,
          isPaused: tournament.status === 'paused',
          timeRemaining: Math.floor(timeRemaining / 1000), // in seconds
          levelDuration: (currentBlind?.duration ?? currentBlind?.duration_minutes ?? 0), // in minutes
          levelStartedAt: clockState?.levelStartedAt
        },
        // 2026-07-25 audit fix: expose the floor message stored in settings.clock_state
        currentMessage: clockState?.current_message || null,
        currentBlind: currentBlind ? {
          level: displayLevelNumber(blindStructure, currentLevel),
          smallBlind: currentBlind.small_blind,
          bigBlind: currentBlind.big_blind,
          ante: currentBlind.ante || 0,
          duration: (currentBlind.duration ?? currentBlind.duration_minutes ?? 0),
          isBreak: currentBlind.is_break || false,
          label: currentBlind.label || null
        } : null,
        nextBlind: nextBlind ? {
          level: displayLevelNumber(blindStructure, currentLevel + 1),
          smallBlind: nextBlind.small_blind,
          bigBlind: nextBlind.big_blind,
          ante: nextBlind.ante || 0,
          duration: (nextBlind.duration ?? nextBlind.duration_minutes ?? 0),
          isBreak: nextBlind.is_break || false,
          label: nextBlind.label || null
        } : null,
        blindStructure: blindStructure.map((b, i) => ({
          level: displayLevelNumber(blindStructure, i),
          smallBlind: b.small_blind,
          bigBlind: b.big_blind,
          ante: b.ante || 0,
          duration: (b.duration ?? b.duration_minutes ?? 0),
          isBreak: b.is_break || false,
          label: b.label || null,
          isCurrent: i === currentLevel
        })),
        // Present only when requested via ?include=
        chips: publicChips,
        payouts: publicPayouts
      }
    });
  } catch (error) {
    console.warn('Get clock state error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to get clock state' }
    });
  }
}

async function handleClockAction(req, res, tournamentId, staff) {
  try {
    // Staff is already validated by guardWriteStaff at the handler level

    const { action } = req.body;

    // Get tournament
    const { data: tournament, error: fetchError } = await getSupabase()
      .from('commander_tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();

    if (fetchError || !tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament not found' }
      });
    }

    // Read persisted clock state from settings
    const settings = tournament.settings || {};
    let clockState = settings.clock_state || {
      isRunning: false,
      levelStartedAt: null,
      pausedAt: null,
      pausedDuration: 0
    };

    let updates = {};

    switch (action) {
      case 'start':
        if (tournament.status === 'running') {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Tournament already running' }
          });
        }
        updates = {
          status: 'running',
          actual_start: new Date().toISOString(),
          current_level: 0
        };
        clockState = {
          isRunning: true,
          levelStartedAt: new Date().toISOString(),
          pausedAt: null,
          pausedDuration: 0,
          // Cards are in the air: a stale break flag would leave BREAK burned
          // onto every display while the event runs.
          on_break: false,
          break_started_at: null
        };

        // --- Push Notification: Tournament Starting ---
        fireTournamentStartNotification(tournamentId, tournament.name).catch(err =>
          console.warn('[clock.js] Start notification failed:', err.message)
        );

        break;

      case 'pause':
        if (tournament.status !== 'running') {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Tournament is not running' }
          });
        }
        updates = { status: 'paused' };
        clockState = {
          isRunning: false,
          levelStartedAt: clockState.levelStartedAt,
          pausedAt: new Date().toISOString(),
          pausedDuration: clockState.pausedDuration || 0
        };
        break;

      case 'resume':
        if (tournament.status !== 'paused') {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Tournament is not paused' }
          });
        }
        updates = { status: 'running' };
        clockState = {
          isRunning: true,
          levelStartedAt: clockState.levelStartedAt,
          pausedAt: null,
          pausedDuration: (clockState.pausedDuration || 0) + (clockState.pausedAt ? Date.now() - new Date(clockState.pausedAt).getTime() : 0),
          // Resuming play ends any break. Without this the TD could press Play
          // and the displays kept showing BREAK for the rest of the level.
          on_break: false,
          break_started_at: null
        };
        break;

      case 'next_level': {
        if (!['running', 'paused'].includes(tournament.status)) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Tournament is not active' }
          });
        }
        // 2026-07-25 audit fix: optional optimistic-concurrency check so multiple
        // displays auto-advancing simultaneously cannot double-advance the level.
        const { from_level } = req.body;
        if (from_level !== undefined && from_level !== null &&
            Number(tournament.current_level || 0) !== Number(from_level)) {
          return res.status(409).json({
            success: false,
            error: { code: 'LEVEL_CONFLICT', message: 'Level already advanced by another client' }
          });
        }
        const blindStructure = parseBlindStructure(tournament.blind_structure);
        const nextLevel = (tournament.current_level || 0) + 1;

        if (nextLevel >= blindStructure.length) {
          // At end of structure - extend the final level rather than hard-stopping.
          // Reset the level timer on the same (last) level so clock keeps running.
          updates = {}; // stay on current level
          clockState = {
            isRunning: tournament.status === 'running',
            levelStartedAt: new Date().toISOString(),
            pausedAt: tournament.status === 'paused' ? new Date().toISOString() : null,
            pausedDuration: 0,
            extended: true // flag that we are in extension mode
          };
          break;
        }

        updates = { current_level: nextLevel };
        clockState = {
          isRunning: tournament.status === 'running',
          levelStartedAt: new Date().toISOString(),
          pausedAt: tournament.status === 'paused' ? new Date().toISOString() : null,
          pausedDuration: 0
        };
        break;
      }

      case 'prev_level':
      case 'previous_level': {
        if (!['running', 'paused'].includes(tournament.status)) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Tournament is not active' }
          });
        }
        const prevLevel = Math.max(0, (tournament.current_level || 0) - 1);
        updates = { current_level: prevLevel };
        clockState = {
          isRunning: tournament.status === 'running',
          levelStartedAt: new Date().toISOString(),
          pausedAt: tournament.status === 'paused' ? new Date().toISOString() : null,
          pausedDuration: 0
        };
        break;
      }

      case 'set_level': {
        const { level } = req.body;
        if (typeof level !== 'number' || level < 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Valid level required' }
          });
        }
        updates = { current_level: level };
        clockState = {
          isRunning: tournament.status === 'running',
          levelStartedAt: new Date().toISOString(),
          pausedAt: tournament.status === 'paused' ? new Date().toISOString() : null,
          pausedDuration: 0
        };
        break;
      }

      case 'add_time': {
        // Add time by pushing levelStartedAt earlier (less elapsed, more remaining).
        // Accepts an optional seconds amount from the console; defaults to 60.
        if (!clockState.levelStartedAt) break;
        const addSecs = Math.min(3600, Math.max(1, Number(req.body.seconds) || 60));
        const started = new Date(clockState.levelStartedAt);
        started.setSeconds(started.getSeconds() - addSecs);
        clockState.levelStartedAt = started.toISOString();
        break;
      }

      case 'subtract_time': {
        // Remove time by pushing levelStartedAt later (more elapsed, less remaining).
        // Accepts an optional seconds amount from the console; defaults to 60.
        if (!clockState.levelStartedAt) break;
        const subSecs = Math.min(3600, Math.max(1, Number(req.body.seconds) || 60));
        const started2 = new Date(clockState.levelStartedAt);
        started2.setSeconds(started2.getSeconds() + subSecs);
        clockState.levelStartedAt = started2.toISOString();
        break;
      }

      case 'break': {
        // Toggle on_break in the settings JSONB (same path all other clock state uses)
        // This keeps on_break + isRunning in one place so floor-view.js reads it correctly
        const isCurrentlyOnBreak = clockState?.on_break || false;
        const updatedBreakField = {
          ...clockState,
          on_break: !isCurrentlyOnBreak,
          break_started_at: !isCurrentlyOnBreak ? new Date().toISOString() : null
        };
        // Merge into clockState so it persists with the main settings write below
        clockState = updatedBreakField;
        // If starting break, pause the clock; if ending break, resume it
        if (!isCurrentlyOnBreak && tournament.status === 'running') {
          updates = { status: 'paused' };
          clockState = {
            ...clockState,
            isRunning: false,
            pausedAt: new Date().toISOString(),
            pausedDuration: clockState.pausedDuration || 0
          };
        } else if (isCurrentlyOnBreak && tournament.status === 'paused') {
          updates = { status: 'running' };
          clockState = {
            ...clockState,
            isRunning: true,
            pausedAt: null,
            pausedDuration: (clockState.pausedDuration || 0) + (clockState.pausedAt ? Date.now() - new Date(clockState.pausedAt).getTime() : 0)
          };
        }
        break;
      }

      case 'final_table':
        if (tournament.status !== 'running') {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Tournament is not running' }
          });
        }
        updates = { status: 'final_table' };
        break;

      case 'end':
        if (!['running', 'paused', 'final_table'].includes(tournament.status)) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Tournament cannot be ended' }
          });
        }
        updates = {
          status: 'completed',
          ended_at: new Date().toISOString()
        };
        clockState = null;
        break;

      default:
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid action' }
        });
    }

    // Carry forward the fields this route does not own (see CARRIED_CLOCK_FIELDS).
    // A branch above that sets one of them explicitly still wins, because the
    // rebuilt clockState is spread last.
    if (clockState) {
      const previous = settings.clock_state || {};
      const carried = {};
      for (const key of CARRIED_CLOCK_FIELDS) {
        if (clockState[key] === undefined && previous[key] !== undefined) {
          carried[key] = previous[key];
        }
      }
      clockState = { ...carried, ...clockState };
    }

    // Persist status/level updates AND clock_state together in ONE atomic
    // statement (commander_clock_write RPC uses jsonb_set on settings.clock_state,
    // so concurrent writes from a second TD tablet cannot lose updates).
    const { data: updatedRow, error: updateError } = await getSupabase()
      .rpc('commander_clock_write', {
        p_tournament_id: tournamentId,
        p_clock_state: clockState,
        p_updates: updates
      });

    if (updateError) {
      console.warn('[clock.js] Update error:', JSON.stringify(updateError, null, 2));
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: updateError.message }
      });
    }

    // --- Push blinds to active tables if level changed ---
    if (updates.current_level !== undefined && updates.current_level !== tournament.current_level) {
      const blindStructure = parseBlindStructure(tournament.blind_structure);
      const newLevel = blindStructure[updates.current_level];
      if (newLevel) {
        const sb = newLevel.small_blind || 0;
        const bb = newLevel.big_blind || 0;
        const stakesStr = `${sb}/${bb}` + (newLevel.ante ? ` (${newLevel.ante}a)` : '');

        // Push the new blinds to all active tables for this tournament (Commander ecosystem)
        await getSupabase()
          .from('commander_tables')
          .update({
            stakes: stakesStr
          })
          .eq('tournament_id', tournamentId)
          .neq('status', 'closed');

        // Push the new blinds to all active tables for this tournament (Club Arena legacy ecosystem)
        await getSupabase()
          .from('tables')
          .update({
            small_blind: sb,
            big_blind: bb,
            stakes: stakesStr
          })
          .eq('tournament_id', tournamentId)
          .neq('status', 'closed');

      }
    }



    // The RPC returns the updated row as jsonb, so no re-fetch round trip.
    const updated = updatedRow;

    // --- AUTO BREAK CHECK (runs only after level advances, post re-entry period) ---
    let autoBreakResult = null;
    if (
      (action === 'next_level' || action === 'set_level') &&
      updates.current_level !== undefined &&
      updated
    ) {
      // checkAndExecuteAutoBreak internally checks if re-entry period is over.
      // If it is and a table can break, it executes the break and returns receipt data.
      autoBreakResult = await checkAndExecuteAutoBreak(tournamentId, updated);
    }

    // Audit log
    await logAction({ action: `clock_${action}`, category: 'tournament' }, {
      venueId: updated.venue_id,
      staffId: staff.id,
      targetId: tournamentId,
      targetType: 'commander_tournaments',
      targetName: updated.name,
      metadata: { action, level: updates.current_level },
      req
    });

    return res.status(200).json({
      success: true,
      data: {
        tournament: updated,
        clock: clockState,
        message: `Tournament ${action} successful`,
        // Included when a table was automatically broken - frontend uses this to print receipts
        auto_break: autoBreakResult || undefined
      }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[clock.js] Clock action exception:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Internal server error' }
    });
  }
}

// --- Push Notification: Mass notify all players that tournament is starting ---
async function fireTournamentStartNotification(tournamentId, tournamentName) {
  if (!isOneSignalConfigured()) return;

  const { data: entries } = await getSupabase()
    .from('commander_tournament_entries')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .in('status', ['registered', 'seated', 'active'])
    .limit(100);

  const playerIds = (entries || []).map(e => e.player_id).filter(Boolean);
  if (playerIds.length === 0) return;

  await sendPushNotification({
    externalUserIds: playerIds,
    title: `${tournamentName || 'Tournament'} Starting Now`,
    message: 'The Tournament Is Starting! Please Take Your Seat.',
    url: `/hub/commander/tournament/${tournamentId}/my-status`,
    data: { type: 'tournament_starting', tournament_id: tournamentId }
  });
}
