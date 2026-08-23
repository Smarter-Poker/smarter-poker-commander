/**
 * Tournament Auto-Break Detection & Execution
 * GET  /api/commander/tournaments/[id]/auto-break - Check if break conditions met, suggest which table
 * POST /api/commander/tournaments/[id]/auto-break - Execute the break with assignments, return receipt data
 *
 * Auto-break logic:
 * - Count total open seats across all OTHER tournament tables
 * - If open seats >= number of players at the smallest table → suggest breaking that table
 * - The system picks the table with fewest players to break
 * - Generates optimal seat assignments distributing players across tables with open seats
 * - Returns printable receipt data for wireless printer
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
// 2026-08-20 security fix: the GET branch returns the full break plan,
// including every affected player's name and their from/to table and seat.
// guardWriteStaff passes GET through WITHOUT verifying anything, so that
// seating map was readable by anyone holding the tournament id. guardStaff
// requires a verified staff session on every method.
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { enqueueSeatChangeReceipts } from '../../../../src/lib/commander/printQueue';
import { rowConflict, countCollisions } from '../../../../src/lib/commander/dbErrors';
import { denyCrossVenue } from '../../../../src/lib/commander/venueScope';
import { LIVE_SEAT_STATUSES } from '../../../../src/lib/commander/tournamentSeating';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: any active staff session for THIS venue (guardStaff + denyCrossVenue).
// NOT role-gated. This header used to claim "requires manager or owner
// role"; neither guardStaff nor guardWriteStaff performs any role check,
// so every role in commander_staff - including dealer and brush - passes.
// Stated accurately rather than aspirationally: a comment that overstates
// the guard is worse than none, because the next reader trusts it.
// Whether the cash-taking routes SHOULD be manager-only is a product
// decision, not a bug fix - see .agent/audits/.
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else if (!applyRateLimit(req, res, LIMITS.read)) {
      // The GET check path was previously unthrottled entirely.
      return;
    }

    const _g = await guardStaff(req, res); if (!_g) return;

    const { id: tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' } });

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
      
      // Venue scope: a valid session for one room must never reach
      // another room's tournament. See src/lib/commander/venueScope.js.
      if (denyCrossVenue(res, _g, tournament)) return;

      if (req.method === 'GET') return handleCheck(req, res, tournament);
      if (req.method === 'POST') return handleExecute(req, res, tournament, _g);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    } catch (err) {
      console.warn('Auto-break error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

async function getTableData(tournamentId, venueId) {
  // Get tournament tables
  const { data: tables, error: tablesError } = await getSupabase()
    .from('commander_tables')
    .select('id, table_number, max_seats')
    .eq('venue_id', venueId)
    .eq('tournament_id', tournamentId)
    .eq('mode', 'tournament')
    .limit(200);

  if (tablesError) {
    console.error('[tournaments/auto-break] commander_tables read failed', {
      tournamentId, venueId, code: tablesError.code,
      message: tablesError.message, details: tablesError.details,
    });
    throw tablesError;
  }

  if (!tables || tables.length < 2) return { tables: tables || [], entries: [], tableMap: {} };

  // Get active entries with their seats
  // 2026-07-28 audit fix: commander_tournament_entries has no member_id column
  // (entries are keyed to profiles via player_id). Selecting it errored the
  // whole query and the error was discarded, so auto-break saw zero players and
  // never suggested a break. There is no venue-member id on this table, so the
  // field is dropped rather than substituted.
  const { data: entries, error: entriesError } = await getSupabase()
    .from('commander_tournament_entries')
    .select('id, player_name, table_number, seat_number, current_chips, player_id')
    .eq('tournament_id', tournamentId)
    // SEAT OCCUPANCY: LIVE_SEAT_STATUSES mirrors the uq_commander_entries_live_seat
    // index exactly. 'registered' holds a chair - omitting it made this probe
    // report a taken seat as free, and the index then raised a 23505 the floor
    // saw as a phantom "another device filled it first". 'bagged' holds none.
        .in('status', LIVE_SEAT_STATUSES)
    .order('table_number')
    .order('seat_number');

  if (entriesError) {
    console.error('[tournaments/auto-break] commander_tournament_entries read failed', {
      tournamentId, code: entriesError.code,
      message: entriesError.message, details: entriesError.details,
    });
    throw entriesError;
  }

  // Build table occupancy map
  const tableMap = {};
  for (const t of tables) {
    tableMap[t.table_number] = {
      ...t,
      players: [],
      open_seats: []
    };
  }
  for (const e of (entries || [])) {
    if (tableMap[e.table_number]) {
      tableMap[e.table_number].players.push(e);
    }
  }
  // Calculate open seats
  for (const tNum of Object.keys(tableMap || {})) {
    const t = tableMap[tNum];
    const occupied = new Set(t.players.map(p => p.seat_number));
    for (let s = 1; s <= t.max_seats; s++) {
      if (!occupied.has(s)) t.open_seats.push(s);
    }
  }

  return { tables, entries: entries || [], tableMap };
}

// GET: Check break conditions
async function handleCheck(req, res, tournament) {
  const { tables, entries, tableMap } = await getTableData(tournament.id, tournament.venue_id);

  if (tables.length < 2) {
    return res.status(200).json({
      success: true,
      data: {
        should_break: false,
        reason: tables.length === 0 ? 'No Tournament Tables' : 'Only One Table Remaining, Final Table',
        tables_active: tables.length,
        total_players: entries.length
      }
    });
  }

  // Find table with fewest players (candidate to break)
  const tableStats = Object.values(tableMap || {})
    .filter(t => t.players.length > 0)
    .sort((a, b) => a.players.length - b.players.length);

  if (tableStats.length < 2) {
    return res.status(200).json({
      success: true,
      data: { should_break: false, reason: 'Not Enough Active Tables', tables_active: tableStats.length }
    });
  }

  // If the TD explicitly requests to break a specific table (manual break),
  // use THAT table as the break candidate - not the auto-detected smallest table.
  const forceTableNum = req.query.force_table ? parseInt(req.query.force_table) : null;
  const breakCandidate = forceTableNum
    ? tableStats.find(t => t.table_number === forceTableNum) || tableStats[0]
    : tableStats[0]; // default: smallest table (auto-break)

  const otherTables = tableStats.filter(t => t.table_number !== breakCandidate.table_number);

  // Count total open seats on OTHER tables
  const totalOpenSeats = otherTables.reduce((sum, t) => sum + t.open_seats.length, 0);
  const playersToMove = breakCandidate.players.length;
  const shouldBreak = totalOpenSeats >= playersToMove;

  // Generate suggested assignments if break is possible
  let assignments = [];
  if (shouldBreak) {
    assignments = generateAssignments(breakCandidate.players, otherTables);
  }

  return res.status(200).json({
    success: true,
    data: {
      should_break: shouldBreak,
      break_table: breakCandidate.table_number,
      players_to_move: playersToMove,
      open_seats_available: totalOpenSeats,
      reason: shouldBreak
        ? `Table ${breakCandidate.table_number} Has ${playersToMove} Players, ${totalOpenSeats} Open Seats Available On Other Tables`
        : `Need ${playersToMove} Open Seats But Only ${totalOpenSeats} Available`,
      assignments,
      tables_active: tableStats.length,
      total_players: entries.length,
      table_summary: tableStats.map(t => ({
        table_number: t.table_number,
        players: t.players.length,
        max_seats: t.max_seats,
        open_seats: t.open_seats.length
      }))
    }
  });
}

// Generate optimal seat assignments - distribute players evenly
function generateAssignments(playersToMove, destinationTables) {
  const assignments = [];
  // Sort destinations by most open seats first (fill bigger gaps first)
  const dests = destinationTables
    .map(t => ({ ...t, available: [...t.open_seats] }))
    .sort((a, b) => b.available.length - a.available.length);

  // Round-robin distribute players across tables to keep them balanced
  let destIdx = 0;
  for (const player of playersToMove) {
    // Find next table with available seats
    let attempts = 0;
    while (dests[destIdx].available.length === 0 && attempts < dests.length) {
      destIdx = (destIdx + 1) % dests.length;
      attempts++;
    }
    if (dests[destIdx].available.length === 0) break; // shouldn't happen if shouldBreak was true

    const seat = dests[destIdx].available.shift();
    assignments.push({
      entry_id: player.id,
      player_name: player.player_name,
      player_id: player.player_id,
      from_table: player.table_number,
      from_seat: player.seat_number,
      to_table: dests[destIdx].table_number,
      to_seat: seat,
      chips: player.current_chips
    });
    destIdx = (destIdx + 1) % dests.length;
  }

  return assignments;
}

// POST: Execute the break
async function handleExecute(req, res, tournament, staff) {
  const { break_table, assignments } = req.body;

  if (!break_table || !Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'break_table And assignments Array Required' } });
  }

  const errors = [];
  const moved = [];

  // Fetch real venue data from both tables in parallel.
  // 2026-08-20 audit fix: this read `venues`, whose id is a UUID and which holds
  // zero rows. commander_tournaments.venue_id is an INTEGER FK to poker_venues,
  // so the comparison was a type error, the error was discarded, and every
  // printed seat-change card said "Smarter Poker" with no city/state.
  const [venueRes, settingsRes] = await Promise.all([
    getSupabase().from('poker_venues').select('name, city, state, logo_url').eq('id', tournament.venue_id).maybeSingle(),
    getSupabase().from('commander_venue_settings').select('club_logo_url').eq('venue_id', tournament.venue_id).maybeSingle()
  ]);
  const venueName = venueRes.data?.name || 'Smarter Poker';
  const venueCity = venueRes.data?.city || null;
  const venueState = venueRes.data?.state || null;
  const venueLogoUrl = settingsRes.data?.club_logo_url || venueRes.data?.logo_url || null;

  // DESTINATIONS MUST BE REAL CHAIRS.
  //
  // This route validated only that the batch had no internal duplicate and
  // that no live entry already held a destination - never that the destination
  // EXISTS. { to_table: 3, to_seat: 99 } was written verbatim, and a seat
  // outside 1..max_seats is invisible to every occupancy scan in the codebase
  // (they all walk `for (s = 1; s <= max_seats; s++)`, as does
  // commander_claim_open_seat), so the player vanished from the floor map
  // while the index still reserved the pair.
  const { data: tableRows, error: tblErr } = await getSupabase()
    .from('commander_tables')
    .select('table_number, max_seats')
    .eq('venue_id', tournament.venue_id)
    .eq('tournament_id', tournament.id)
    .limit(200);

  if (tblErr) {
    console.error('[tournaments/auto-break] table read failed', {
      tournamentId: tournament.id, code: tblErr.code, message: tblErr.message,
    });
    return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Verify Destination Tables' } });
  }

  // Only enforce against a real table list. A room that seats without
  // commander_tables rows would otherwise have every break rejected, so an
  // empty list falls back to a plain bounds check.
  const seatCapacity = new Map((tableRows || []).map(t => [Number(t.table_number), Number(t.max_seats) || 9]));

  for (const a of assignments) {
    const t = Number(a.to_table);
    const st = Number(a.to_seat);
    if (!Number.isInteger(t) || t < 1 || !Number.isInteger(st) || st < 1) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Table And Seat Must Be Whole Numbers Above Zero (Got Table ${a.to_table} Seat ${a.to_seat})` }
      });
    }
    if (seatCapacity.size > 0) {
      if (!seatCapacity.has(t)) {
        return res.status(400).json({
          success: false,
          error: { code: 'UNKNOWN_TABLE', message: `Table ${t.toLocaleString()} Is Not Assigned To This Tournament` }
        });
      }
      const cap = seatCapacity.get(t);
      if (st > cap) {
        return res.status(400).json({
          success: false,
          error: { code: 'SEAT_OUT_OF_RANGE', message: `Table ${t.toLocaleString()} Has ${cap.toLocaleString()} Seats. Seat ${st.toLocaleString()} Does Not Exist.` }
        });
      }
    } else if (st > 12) {
      return res.status(400).json({
        success: false,
        error: { code: 'SEAT_OUT_OF_RANGE', message: `Seat ${st.toLocaleString()} Is Outside The Largest Supported Table.` }
      });
    }
  }

  // Validate no seat conflicts
  const seatKeys = new Set();
  for (const a of assignments) {
    const key = `${a.to_table}-${a.to_seat}`;
    if (seatKeys.has(key)) {
      return res.status(400).json({ success: false, error: { code: 'DUPLICATE_SEAT', message: `Duplicate Seat: Table ${a.to_table} Seat ${a.to_seat}` } });
    }
    seatKeys.add(key);
  }

  // 2026-07-25 audit fix: RACE CONDITION GUARD - re-query current occupied seats
  // and 409 if any destination seat was taken since the assignments were
  // generated (mirrors balance-execute.js's conflictingSeats guard).
  const movingEntryIds = new Set(assignments.map(a => a.entry_id));
  const { data: currentSeats, error: cErr } = await getSupabase()
    .from('commander_tournament_entries')
    .select('id, table_number, seat_number, player_name, current_chips, status')
    .eq('tournament_id', tournament.id)
    // SEAT OCCUPANCY: LIVE_SEAT_STATUSES mirrors the uq_commander_entries_live_seat
    // index exactly. 'registered' holds a chair - omitting it made this probe
    // report a taken seat as free, and the index then raised a 23505 the floor
    // saw as a phantom "another device filled it first". 'bagged' holds none.
    .in('status', LIVE_SEAT_STATUSES);

  // A discarded error here made the guard pass on an empty result and the break
  // went on to overwrite live seats.
  if (cErr) {
    console.error('[tournaments/auto-break] seat conflict read failed', {
      tournamentId: tournament.id, code: cErr.code, message: cErr.message, details: cErr.details,
    });
    return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Verify Destination Seats' } });
  }

  const liveSeats = currentSeats || [];

  const occupiedList = liveSeats.filter(e =>
    !movingEntryIds.has(e.id) &&
    assignments.some(a => a.to_table === e.table_number && a.to_seat === e.seat_number)
  );

  if (occupiedList.length > 0) {
    const e = occupiedList[0];
    return res.status(409).json({
      success: false,
      error: { code: 'SEAT_OCCUPIED', message: `Break Aborted: Seat ${e.seat_number} At Table ${e.table_number} Is Now Occupied By ${e.player_name || 'Another Player'}` }
    });
  }

  // Every live player on the table being broken MUST have an assignment.
  // Without this the table was released back to the pool while a player was
  // still recorded as sitting at it, and that player vanished from the map.
  const breakTableNum = Number(break_table);
  const leftBehind = liveSeats.filter(e => e.table_number === breakTableNum && !movingEntryIds.has(e.id));
  if (leftBehind.length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'PLAYERS_LEFT_BEHIND',
        message: `Table ${break_table} Still Has ${leftBehind.length} Unassigned Player(s): ${leftBehind.map(e => e.player_name || 'Unknown').join(', ')}`
      }
    });
  }

  // Index the live rows so the receipt is built from what the DATABASE says the
  // player's origin and stack were, not from client-supplied assignment fields.
  const liveById = new Map(liveSeats.map(e => [e.id, e]));

  // Execute moves
  for (const a of assignments) {
    const live = liveById.get(a.entry_id);
    if (!live) {
      errors.push({ entry_id: a.entry_id, error: 'Entry Not Active In This Tournament' });
      continue;
    }

    const { data: currentEntry } = await getSupabase()
      .from('commander_tournament_entries')
      .select('metadata')
      .eq('id', a.entry_id)
      .eq('tournament_id', tournament.id)
      .maybeSingle();

    const existingMetadata = currentEntry?.metadata || {};

    const { error } = await getSupabase()
      .from('commander_tournament_entries')
      .update({
        table_number: a.to_table,
        seat_number: a.to_seat,
        metadata: {
          ...existingMetadata,
          last_moved_at: new Date().toISOString(),
          last_moved_from: { table: live.table_number, seat: live.seat_number },
          move_reason: 'table_break'
        }
      })
      .eq('id', a.entry_id)
      // 2026-07-25 audit fix: scope the update to this tournament so a stray
      // entry_id from another tournament cannot be moved.
      .eq('tournament_id', tournament.id);

    if (error) {
      // One player's collision must not abort the break. The broken table is
      // only released when errors.length === 0, so a partial break leaves the
      // table open and nobody is stranded without a chair.
      errors.push(rowConflict(error, {
        entryId: a.entry_id,
        playerName: live.player_name || a.player_name,
        tableNumber: a.to_table,
        seatNumber: a.to_seat,
        action: 'Table Break'
      }));
    } else {
      moved.push({
        ...a,
        player_name: live.player_name || a.player_name,
        from_table: live.table_number,
        from_seat: live.seat_number,
        chips: live.current_chips ?? a.chips ?? null
      });
    }
  }

  // Release the broken table back to inactive (ONLY if all players successfully moved)
  // 2026-07-28 audit fix: commander_tables has no updated_at column - including
  // it made PostgREST reject this UPDATE, so the broken table was never released
  // back to the pool. The discarded error is now surfaced.
  // 2026-08-20 audit fix, matching tournamentAutoBreak.js:
  //  1. table_purpose was left set to 'tournament' on the released table, so
  //     player-unseat.js / player-scan-in.js (which test `mode === 'tournament'
  //     || table_purpose === 'tournament'`) kept treating a closed table as a
  //     live tournament table. game_type/stakes were left stale for the same
  //     reason.
  //  2. the release was scoped by venue_id + table_number ONLY. With two
  //     events running in one room, "Table 5" exists for both, and breaking
  //     one tournament's table 5 released the other tournament's table 5 too.
  //     Scope by tournament_id.
  if (errors.length === 0) {
    const { data: released, error: releaseError } = await getSupabase()
      .from('commander_tables')
      .update({
        mode: 'inactive',
        table_purpose: null,
        tournament_id: null,
        game_type: null,
        stakes: null,
        status: 'available',
        assigned_at: null,
        assigned_by: null
      })
      .eq('venue_id', tournament.venue_id)
      .eq('tournament_id', tournament.id)
      .eq('table_number', break_table)
      .select('id');

    // A zero-row update is not a PostgREST error. Without this the table could
    // stay flagged as an active tournament table and nobody would ever know.
    if (!releaseError && (!released || released.length === 0)) {
      console.warn('[tournaments/auto-break] release matched no rows', {
        venue_id: tournament.venue_id, tournament_id: tournament.id, table_number: break_table
      });
    }

    if (releaseError) {
      console.error('[tournaments/auto-break] commander_tables release failed', {
        venue_id: tournament.venue_id, tournament_id: tournament.id, table_number: break_table,
        code: releaseError.code, message: releaseError.message, details: releaseError.details,
      });
      errors.push({ table_number: break_table, error: releaseError.message });
    }
  }

  // Build receipt data for printing (full venue-level identity)
  const receipts = moved.map(a => ({
    tournament_name: tournament.name,
    venue_name: venueName,
    venue_city: venueCity,
    venue_state: venueState,
    venue_logo_url: venueLogoUrl,
    buyin_amount: tournament.buyin_amount,
    player_name: a.player_name,
    from_table: a.from_table,
    from_seat: a.from_seat,
    to_table: a.to_table,
    to_seat: a.to_seat,
    chips: a.chips,
    timestamp: new Date().toISOString()
  }));

  // Queue the seat-change cards server-side. The caller may be a table tablet
  // or a screen whose popup is blocked; either way the cards must still come
  // out at the floor print station. enqueueSeatChangeReceipts never throws, so
  // a queue failure cannot roll back a break that already moved players.
  let printJobId = null;
  if (receipts.length > 0) {
    const job = await enqueueSeatChangeReceipts(getSupabase(), {
      venueId: tournament.venue_id,
      tournamentId: tournament.id,
      receipts,
      brokenTable: Number(break_table),
      source: 'auto_break_manual',
      createdBy: staff?.id || null
    });
    printJobId = job?.id || null;
  }

  const collided = countCollisions(errors);

  return res.status(200).json({
    success: errors.length === 0,
    data: {
      table_broken: break_table,
      players_moved: moved.length,
      players_failed: errors.length,
      seat_collisions: collided,
      moves: moved,
      receipts,
      print_job_id: printJobId,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length === 0
        ? `Table ${break_table} Broken. ${moved.length} Player${moved.length === 1 ? '' : 's'} Moved.`
        : `Table ${break_table} Not Fully Broken. ${moved.length} Moved, ${errors.length} Failed${collided > 0 ? `, ${collided} Because The Destination Seat Was Already Taken` : ''}. The Table Stays Open Until Every Player Has A Seat.`
    }
  });
}
