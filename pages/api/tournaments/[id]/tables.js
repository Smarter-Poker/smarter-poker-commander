/**
 * Tournament Table Assignment API
 * GET    /api/commander/tournaments/[id]/tables
 * POST   /api/commander/tournaments/[id]/tables   { table_numbers: [1,2] } | { count: 4 }
 * DELETE /api/commander/tournaments/[id]/tables   { table_numbers: [1] }   | {} = all
 *
 * WHY THIS EXISTS
 * ---------------
 * Creating a tournament never wrote a single commander_tables row. The only
 * writer was PUT /api/commander/table-assignments, reachable from exactly one
 * page that no tournament screen links to. Two features read those rows and
 * both silently did nothing without them:
 *   - tournamentAutoBreak.js requires >= 2 rows with tournament_id set and
 *     mode = 'tournament'. Fewer than 2 and auto-break returns null forever.
 *   - seat-draw.js prefers those rows as its table source, and falls back to
 *     synthesized table numbers that may not match the physical room.
 * So a tournament could run all night and never break a table.
 *
 * Release shape mirrors tournamentAutoBreak.js exactly so a table released
 * here and a table released by an auto-break end up in the same state.
 *
 * NOTE: commander_tables has NO updated_at column. Including one makes
 * PostgREST reject the UPDATE and the table is never written.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../src/lib/commander/audit';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Entry statuses that mean a human is physically sitting at the table.
// 'registered' players are not seated yet, so they never block a release.
// 'bagged' players (multi-day, chips in a bag overnight) are not sitting
// either - they are still in the tournament but hold no chair, and bag-and-tag
// releases the room's tables precisely so cash games can use them. Counting
// them here would make every table look occupied until the next day started.
const SEATED_STATUSES = ['active', 'seated'];

/** A table nobody is using: free of a tournament, not a live cash game. */
function isAvailable(t) {
  if (t.tournament_id) return false;
  if (t.mode === 'cash') return false;
  if (t.status && !['available', 'open', 'idle'].includes(t.status)) return false;
  return true;
}

function shapeTable(t, playerCount) {
  return {
    id: t.id,
    table_number: t.table_number,
    table_name: t.table_name || `Table ${t.table_number}`,
    max_seats: t.max_seats || 9,
    mode: t.mode || 'inactive',
    status: t.status || 'available',
    table_purpose: t.table_purpose || null,
    tournament_id: t.tournament_id || null,
    assigned_at: t.assigned_at || null,
    player_count: playerCount || 0
  };
}

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else if (!applyRateLimit(req, res, LIMITS.read)) return;

    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { id: tournamentId } = req.query;
    if (!tournamentId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Tournament Id Is Required' }
      });
    }

    const { data: tournament } = await getSupabase()
      .from('commander_tournaments')
      .select('id, venue_id, name, status')
      .eq('id', tournamentId)
      .maybeSingle();

    if (!tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }

    // Venue always comes from the verified staff session, never the body, so
    // one room can never assign another room's tables.
    const venueId = Number(staff.venue_id);
    if (!venueId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Venue Could Not Be Resolved For This Session' }
      });
    }
    if (Number(tournament.venue_id) !== venueId) {
      return res.status(403).json({
        success: false,
        error: { code: 'WRONG_VENUE', message: 'Tournament Belongs To A Different Venue' }
      });
    }

    if (req.method === 'GET') return handleGet(req, res, tournament, venueId);
    if (req.method === 'POST') return handleAssign(req, res, tournament, venueId, staff);
    if (req.method === 'DELETE') return handleRelease(req, res, tournament, venueId, staff);

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[tournaments/tables] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Table Assignment Failed' }
      });
    }
  }
}

/** Every commander_tables row for the venue, plus seated counts per table. */
async function loadRoom(tournamentId, venueId) {
  const { data: tables, error } = await getSupabase()
    .from('commander_tables')
    .select('id, table_number, table_name, max_seats, mode, status, table_purpose, tournament_id, assigned_at')
    .eq('venue_id', venueId)
    .order('table_number', { ascending: true })
    .limit(300);

  if (error) {
    console.error('[tournaments/tables] commander_tables read failed', {
      venueId, code: error.code, message: error.message, details: error.details
    });
    return { error };
  }

  const { data: entries, error: entriesErr } = await getSupabase()
    .from('commander_tournament_entries')
    .select('id, player_name, table_number, seat_number, status')
    .eq('tournament_id', tournamentId)
    .in('status', SEATED_STATUSES)
    .limit(5000);

  if (entriesErr) {
    console.error('[tournaments/tables] entries read failed', {
      tournamentId, code: entriesErr.code, message: entriesErr.message, details: entriesErr.details
    });
    return { error: entriesErr };
  }

  const seatedByTable = new Map();
  for (const e of entries || []) {
    if (!e.table_number) continue;
    if (!seatedByTable.has(e.table_number)) seatedByTable.set(e.table_number, []);
    seatedByTable.get(e.table_number).push(e);
  }

  return { tables: tables || [], seatedByTable };
}

// ── GET: what this tournament holds, and what it could take ──────────────
async function handleGet(req, res, tournament, venueId) {
  const room = await loadRoom(tournament.id, venueId);
  if (room.error) {
    return res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: 'Failed To Read The Table List' }
    });
  }

  const assigned = [];
  const available = [];
  for (const t of room.tables) {
    if (t.tournament_id === tournament.id) {
      assigned.push(shapeTable(t, (room.seatedByTable.get(t.table_number) || []).length));
    } else if (isAvailable(t)) {
      available.push(shapeTable(t, 0));
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      tournament_id: tournament.id,
      assigned_tables: assigned,
      available_tables: available,
      assigned_count: assigned.length,
      available_count: available.length,
      // Auto-break needs at least two assigned tables before it will ever fire.
      auto_break_ready: assigned.length >= 2
    }
  });
}

// ── POST: assign tables to this tournament ───────────────────────────────
async function handleAssign(req, res, tournament, venueId, staff) {
  const body = req.body || {};
  const rawNumbers = Array.isArray(body.table_numbers) ? body.table_numbers : null;
  const rawCount = body.count;

  if (!rawNumbers && (rawCount === undefined || rawCount === null)) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Provide Either table_numbers Or count' }
    });
  }

  const room = await loadRoom(tournament.id, venueId);
  if (room.error) {
    return res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: 'Failed To Read The Table List' }
    });
  }

  const byNumber = new Map(room.tables.map(t => [Number(t.table_number), t]));
  let targets = [];
  let requested = 0;

  if (rawNumbers) {
    const wanted = [...new Set(rawNumbers.map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0))];
    requested = wanted.length;
    if (wanted.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'table_numbers Must Contain At Least One Table Number' }
      });
    }

    const missing = wanted.filter(n => !byNumber.has(n));
    if (missing.length > 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TABLE_NOT_FOUND',
          message: `These Tables Do Not Exist At This Venue: ${missing.join(', ')}`
        }
      });
    }

    const rows = wanted.map(n => byNumber.get(n));

    // Never steal a table another tournament is already running on.
    const conflicts = rows.filter(t => t.tournament_id && t.tournament_id !== tournament.id);
    if (conflicts.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'TABLE_CONFLICT',
          message: `Already Assigned To Another Tournament: Table ${conflicts.map(t => t.table_number).join(', ')}`
        },
        data: { conflicting_tables: conflicts.map(t => t.table_number) }
      });
    }

    // Nor a table with a live cash game on it.
    const cashBusy = rows.filter(t => !t.tournament_id && t.mode === 'cash' && t.status !== 'available');
    if (cashBusy.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'TABLE_IN_USE',
          message: `A Cash Game Is Running On: Table ${cashBusy.map(t => t.table_number).join(', ')}`
        },
        data: { conflicting_tables: cashBusy.map(t => t.table_number) }
      });
    }

    // Already ours: skip the write, do not report it as a failure.
    targets = rows.filter(t => t.tournament_id !== tournament.id);
  } else {
    const count = Number(rawCount);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'count Must Be A Whole Number Between 1 And 100' }
      });
    }
    requested = count;

    const alreadyMine = room.tables.filter(t => t.tournament_id === tournament.id).length;
    const stillNeeded = Math.max(0, count - alreadyMine);
    const pool = room.tables.filter(isAvailable);

    if (stillNeeded > 0 && pool.length === 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'NO_AVAILABLE_TABLES',
          message: 'No Free Tables At This Venue. Close A Game Or Add Tables In Table Assignments First.'
        },
        data: { assigned_count: alreadyMine }
      });
    }
    targets = pool.slice(0, stillNeeded);
  }

  const assignedAt = new Date().toISOString();
  const assignedBy = UUID_RE.test(String(staff.id || '')) ? staff.id : null;
  const updated = [];
  const errors = [];

  for (const t of targets) {
    const { data, error } = await getSupabase()
      .from('commander_tables')
      .update({
        mode: 'tournament',
        table_purpose: 'tournament',
        tournament_id: tournament.id,
        game_type: null,
        stakes: null,
        status: 'in_use',
        assigned_at: assignedAt,
        assigned_by: assignedBy
      })
      .eq('id', t.id)
      .eq('venue_id', venueId)
      // Optimistic guard: only claim a table that is still unclaimed (or
      // already ours). Two floor staff assigning at once cannot both win.
      .or(`tournament_id.is.null,tournament_id.eq.${tournament.id}`)
      .select('id, table_number, table_name, max_seats, mode, status, table_purpose, tournament_id, assigned_at')
      .maybeSingle();

    if (error) {
      errors.push({ table_number: t.table_number, message: error.message });
    } else if (!data) {
      // The .or() guard rejected it: someone claimed the table mid-flight.
      errors.push({ table_number: t.table_number, message: 'Table Was Claimed By Another Tournament' });
    } else {
      updated.push(shapeTable(data, 0));
    }
  }

  const totalAssigned = room.tables.filter(t => t.tournament_id === tournament.id).length + updated.length;

  await logAction({ action: 'assign_tournament_tables', category: 'tournament' }, {
    venueId,
    staffId: staff.id,
    targetId: tournament.id,
    targetType: 'commander_tournaments',
    targetName: tournament.name,
    metadata: {
      requested,
      assigned: updated.map(t => t.table_number),
      errors: errors.length
    },
    req
  });

  const shortfall = requested > 0 && totalAssigned < requested;
  return res.status(200).json({
    success: errors.length === 0,
    data: {
      assigned_tables: updated,
      assigned_count: totalAssigned,
      auto_break_ready: totalAssigned >= 2,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length > 0
        ? `${updated.length} Table(s) Assigned, ${errors.length} Failed.`
        : shortfall
          ? `${totalAssigned} Table(s) Assigned. Only ${totalAssigned} Of ${requested} Were Free.`
          : `${totalAssigned} Table(s) Assigned To ${tournament.name || 'This Tournament'}.`
    }
  });
}

// ── DELETE: release tables back to the room ──────────────────────────────
async function handleRelease(req, res, tournament, venueId, staff) {
  const body = req.body || {};
  const rawNumbers = Array.isArray(body.table_numbers) ? body.table_numbers : null;

  const room = await loadRoom(tournament.id, venueId);
  if (room.error) {
    return res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: 'Failed To Read The Table List' }
    });
  }

  const mine = room.tables.filter(t => t.tournament_id === tournament.id);
  let targets = mine;

  if (rawNumbers) {
    const wanted = new Set(rawNumbers.map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0));
    if (wanted.size === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'table_numbers Must Contain At Least One Table Number' }
      });
    }
    targets = mine.filter(t => wanted.has(Number(t.table_number)));
    const notMine = [...wanted].filter(n => !mine.some(t => Number(t.table_number) === n));
    if (notMine.length > 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TABLE_NOT_ASSIGNED',
          message: `Not Assigned To This Tournament: Table ${notMine.join(', ')}`
        }
      });
    }
  }

  if (targets.length === 0) {
    return res.status(200).json({
      success: true,
      data: {
        released_tables: [],
        assigned_count: 0,
        auto_break_ready: false,
        message: 'No Tables Were Assigned To This Tournament.'
      }
    });
  }

  // Releasing a table that still has players parked on it is exactly how
  // entries get orphaned: the row goes back to 'available' while
  // commander_tournament_entries still points at that table number, and the
  // players vanish from every table view. Refuse and name them.
  const blocked = [];
  for (const t of targets) {
    const seated = room.seatedByTable.get(t.table_number) || [];
    if (seated.length > 0) {
      blocked.push({
        table_number: t.table_number,
        players: seated.map(p => p.player_name).filter(Boolean)
      });
    }
  }
  if (blocked.length > 0) {
    const summary = blocked
      .map(b => `Table ${b.table_number} (${b.players.length ? b.players.join(', ') : `${b.players.length} Players`})`)
      .join('; ');
    return res.status(409).json({
      success: false,
      error: {
        code: 'TABLE_OCCUPIED',
        message: `Players Are Still Seated. Move Them First: ${summary}`
      },
      data: { blocked_tables: blocked }
    });
  }

  const released = [];
  const errors = [];
  for (const t of targets) {
    // Release shape is identical to tournamentAutoBreak.js so a manual release
    // and an auto-break release leave the row in the same state.
    const { error } = await getSupabase()
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
      .eq('id', t.id)
      .eq('venue_id', venueId)
      .eq('tournament_id', tournament.id);

    if (error) {
      errors.push({ table_number: t.table_number, message: error.message });
    } else {
      released.push(t.table_number);
    }
  }

  // Any leftover seat rows would keep the table looking occupied on tablets.
  for (const tableNumber of released) {
    const { error: seatErr } = await getSupabase()
      .from('commander_table_seats')
      .delete()
      .eq('venue_id', venueId)
      .eq('table_number', tableNumber);
    if (seatErr) {
      console.warn(`[tournaments/tables] Seat cleanup for table ${tableNumber} failed:`, seatErr.message);
    }
  }

  const remaining = mine.length - released.length;

  await logAction({ action: 'release_tournament_tables', category: 'tournament' }, {
    venueId,
    staffId: staff.id,
    targetId: tournament.id,
    targetType: 'commander_tournaments',
    targetName: tournament.name,
    metadata: { released, errors: errors.length },
    req
  });

  return res.status(200).json({
    success: errors.length === 0,
    data: {
      released_tables: released,
      assigned_count: remaining,
      auto_break_ready: remaining >= 2,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length > 0
        ? `${released.length} Table(s) Released, ${errors.length} Failed.`
        : `${released.length} Table(s) Released.`
    }
  });
}
