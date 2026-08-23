/**
 * Tournament Dealer Rotation API
 * GET  /api/commander/tournaments/[id]/dealers
 * POST /api/commander/tournaments/[id]/dealers
 *
 * WHY THIS EXISTS
 * commander_dealer_rotations has always been room-wide: a dealer, a table and
 * a start time. Nothing tied a rotation to a TOURNAMENT, so the TD running an
 * event had no way to see who was down at their tables, how long they had been
 * there, or who was coming in next. The rotation screen at
 * /commander/dealer-rotation is a cash-room view and shows the whole floor.
 *
 * The link is commander_tables: a tournament's tables are the rows with
 * tournament_id set, and a rotation points at a table through table_id. No
 * schema change is needed to scope a rotation to an event.
 *
 * GET returns, per assigned table: the dealer down, how long they have been
 * down, and who pushes in next.
 *
 * POST bodies:
 *   { action: 'push_all' }                       every dealer moves up one table
 *   { action: 'push_table', table_number, dealer_id? }  one table only
 *   Add { force: true } to push while the clock is on break.
 *
 * Auth: STAFF at the tournament's venue.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../src/lib/commander/audit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
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

// A dealer past this on one table is flagged. Most rooms push every 30
// minutes; anything beyond it is either a missed push or a short-staffed
// stretch, and both are things the TD wants to see before the dealer does.
// Not exported: this is a page module, and nothing outside it reads this.
const DOWN_TIME_LIMIT_MINUTES = 30;

function minutesSince(ts) {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

/** The tournament's tables, in push order (ascending table number). */
async function fetchTournamentTables(supabase, tournamentId) {
  const { data, error } = await supabase
    .from('commander_tables')
    .select('id, table_number, table_name, status, mode')
    .eq('tournament_id', tournamentId)
    .order('table_number', { ascending: true });

  if (error) {
    console.error('[tournaments/dealers] table read failed', {
      tournamentId, code: error.code, message: error.message, details: error.details,
    });
    return [];
  }
  return data || [];
}

/**
 * Live rotations (ended_at IS NULL) sitting on this tournament's tables.
 *
 * Matching is on table_number, NOT table_id. Verified against production
 * 2026-08-20: of 42 open rotations, all 42 carry venue_id + table_number and
 * only 12 carry table_id, because the dealer tablet writes the number and the
 * rotation screen writes the id. Filtering on table_id alone would have found
 * roughly a quarter of the dealers actually down. table_id is still matched as
 * a second key so a row with a number that drifted is not lost.
 */
async function fetchActiveRotations(supabase, venueId, tables) {
  if (!tables || tables.length === 0) return [];

  const { data, error } = await supabase
    .from('commander_dealer_rotations')
    .select('id, dealer_id, dealer_name, table_id, table_number, started_at')
    .eq('venue_id', venueId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[tournaments/dealers] rotation read failed', {
      code: error.code, message: error.message, details: error.details,
    });
    return [];
  }

  const idSet = new Set(tables.map(t => t.id));
  const numberSet = new Set(tables.map(t => t.table_number));
  // Stamp the resolved table id on each row so every consumer below can key on
  // it whether or not the writer set it.
  const byNumber = new Map(tables.map(t => [t.table_number, t.id]));

  return (data || [])
    .filter(r => (r.table_id && idSet.has(r.table_id)) || (r.table_number != null && numberSet.has(r.table_number)))
    .map(r => ({ ...r, table_id: r.table_id || byNumber.get(r.table_number) || null }));
}

/**
 * End every live rotation on these tables, stamping the down time so the
 * duration is recoverable from the row itself instead of a subtraction nobody
 * can see. Returns the rows that were ended.
 */
async function endRotations(supabase, rotations) {
  const endedAt = new Date().toISOString();
  const results = [];
  for (const r of rotations) {
    const { error } = await supabase
      .from('commander_dealer_rotations')
      .update({
        ended_at: endedAt,
        duration_minutes: minutesSince(r.started_at)
      })
      .eq('id', r.id)
      .is('ended_at', null);
    if (error) {
      console.error('[tournaments/dealers] failed to end rotation', {
        rotation_id: r.id, code: error.code, message: error.message,
      });
    } else {
      results.push(r);
    }
  }
  return results;
}

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else if (!applyRateLimit(req, res, LIMITS.read)) return;

    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { id: tournamentId } = req.query;

    const { data: tournament, error: tErr } = await getSupabase()
      .from('commander_tournaments')
      .select('id, venue_id, name, status, settings')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tErr || !tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }

    // One shared check. This was one of three hand-written spellings, and
    // this one fell OPEN on a null or 0 venue_id.
    if (denyCrossVenue(res, staff, tournament)) return;

    if (req.method === 'GET') return getDealers(req, res, tournament);
    if (req.method === 'POST') return pushDealers(req, res, tournament, staff);

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[tournaments/dealers] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Internal Server Error' }
      });
    }
  }
}

async function getDealers(req, res, tournament) {
  const supabase = getSupabase();
  const tables = await fetchTournamentTables(supabase, tournament.id);
  const rotations = await fetchActiveRotations(supabase, tournament.venue_id, tables);

  // Whole roster, so the screen can offer who to bring in.
  const { data: roster } = await supabase
    .from('commander_dealers')
    .select('id, name, employee_id, skill_level, current_status, break_started_at')
    .eq('venue_id', tournament.venue_id)
    .eq('is_active', true)
    .order('name', { ascending: true });

  // One rotation per table: the newest wins if an old one was never ended.
  const byTable = new Map();
  rotations.forEach(r => { if (!byTable.has(r.table_id)) byTable.set(r.table_id, r); });

  // Push order is ascending table number, wrapping at the end. The dealer who
  // pushes INTO table i is the one currently on table i-1.
  const n = tables.length;
  const shaped = tables.map((t, i) => {
    const current = byTable.get(t.id) || null;
    const prev = n > 0 ? byTable.get(tables[(i - 1 + n) % n].id) : null;
    const down = current ? minutesSince(current.started_at) : null;

    return {
      table_id: t.id,
      table_number: t.table_number,
      table_name: t.table_name || `Table ${t.table_number}`,
      status: t.status || null,
      current_dealer: current
        ? {
          rotation_id: current.id,
          dealer_id: current.dealer_id,
          dealer_name: current.dealer_name || 'Dealer',
          started_at: current.started_at,
          minutes_down: down,
          over_limit: down != null && down > DOWN_TIME_LIMIT_MINUTES
        }
        : null,
      // Null when the table behind is empty too, which is the honest answer:
      // there is nobody to push in and the floor has to fill it.
      next_dealer: (prev && n > 1 && prev.id !== current?.id)
        ? {
          dealer_id: prev.dealer_id,
          dealer_name: prev.dealer_name || 'Dealer',
          from_table_number: prev.table_number
        }
        : null
    };
  });

  const assignedDealerIds = new Set(rotations.map(r => r.dealer_id).filter(Boolean));
  const available = (roster || [])
    .filter(d => !assignedDealerIds.has(d.id) && d.current_status !== 'on_break')
    .map(d => ({ id: d.id, name: d.name, employee_id: d.employee_id, current_status: d.current_status || 'available' }));
  const onBreak = (roster || [])
    .filter(d => !assignedDealerIds.has(d.id) && d.current_status === 'on_break')
    .map(d => ({
      id: d.id, name: d.name, employee_id: d.employee_id,
      minutes_on_break: minutesSince(d.break_started_at)
    }));

  const clockState = (tournament.settings || {}).clock_state || {};

  return res.status(200).json({
    success: true,
    data: {
      tournament: {
        id: tournament.id,
        name: tournament.name,
        status: tournament.status,
        on_break: !!clockState.on_break
      },
      down_time_limit_minutes: DOWN_TIME_LIMIT_MINUTES,
      tables: shaped,
      available_dealers: available,
      on_break_dealers: onBreak,
      alerts: {
        on_break: !!clockState.on_break,
        // The whole point of the screen: who has been down too long.
        over_limit: shaped
          .filter(t => t.current_dealer?.over_limit)
          .map(t => ({
            table_number: t.table_number,
            dealer_name: t.current_dealer.dealer_name,
            minutes_down: t.current_dealer.minutes_down
          })),
        unmanned_tables: shaped.filter(t => !t.current_dealer).map(t => t.table_number)
      }
    }
  });
}

async function pushDealers(req, res, tournament, staff) {
  const supabase = getSupabase();
  const action = req.body?.action || 'push_all';
  const force = req.body?.force === true;

  if (!['push_all', 'push_table'].includes(action)) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: "action Must Be 'push_all' Or 'push_table'." }
    });
  }

  // Break gate. Dealers do push on breaks, so this is refusable rather than
  // absolute: the TD gets told, and can send it again with force.
  const clockState = (tournament.settings || {}).clock_state || {};
  if (clockState.on_break && !force) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'ON_BREAK',
        message: 'The Clock Is On Break. Push Again With Force To Rotate During The Break.'
      }
    });
  }

  const tables = await fetchTournamentTables(supabase, tournament.id);
  if (tables.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'NO_TABLES',
        message: 'No Tables Are Assigned To This Tournament Yet.'
      }
    });
  }

  const rotations = await fetchActiveRotations(supabase, tournament.venue_id, tables);
  const byTable = new Map();
  rotations.forEach(r => { if (!byTable.has(r.table_id)) byTable.set(r.table_id, r); });

  const startedAt = new Date().toISOString();
  const inserts = [];
  const moves = [];

  if (action === 'push_table') {
    const tableNumber = parseInt(req.body?.table_number, 10);
    const table = tables.find(t => t.table_number === tableNumber);
    if (!table) {
      return res.status(404).json({
        success: false,
        error: { code: 'TABLE_NOT_FOUND', message: `Table ${req.body?.table_number} Is Not Assigned To This Tournament.` }
      });
    }

    // Explicit dealer, or the one on the table behind this one.
    let dealerId = (typeof req.body?.dealer_id === 'string' && req.body.dealer_id.trim())
      ? req.body.dealer_id.trim()
      : null;
    let dealerName = null;

    if (!dealerId) {
      const i = tables.findIndex(t => t.id === table.id);
      const prev = byTable.get(tables[(i - 1 + tables.length) % tables.length].id);
      if (!prev || prev.table_id === table.id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_NEXT_DEALER',
            message: 'There Is No Dealer On The Table Behind This One. Choose A Dealer To Bring In.'
          }
        });
      }
      dealerId = prev.dealer_id;
      dealerName = prev.dealer_name;
    }

    const { data: dealer } = await supabase
      .from('commander_dealers')
      .select('id, name')
      .eq('id', dealerId)
      .eq('venue_id', tournament.venue_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!dealer) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEALER_NOT_FOUND', message: 'That Dealer Was Not Found At This Venue.' }
      });
    }

    // End the rotation on the target table AND every open rotation this dealer
    // holds anywhere in the room, or they end up recorded at two tables at
    // once. The second read is venue-wide on purpose: a dealer pulled off a
    // cash table into the tournament still has that cash rotation open.
    const onTarget = byTable.get(table.id);
    const toEnd = onTarget ? [onTarget] : [];

    const { data: dealerOpen } = await supabase
      .from('commander_dealer_rotations')
      .select('id, started_at, table_number')
      .eq('venue_id', tournament.venue_id)
      .eq('dealer_id', dealer.id)
      .is('ended_at', null)
      .limit(50);

    (dealerOpen || []).forEach(r => {
      if (!toEnd.some(x => x.id === r.id)) toEnd.push(r);
    });

    await endRotations(supabase, toEnd);

    inserts.push({
      venue_id: tournament.venue_id,
      dealer_id: dealer.id,
      dealer_name: dealer.name || dealerName || 'Dealer',
      table_id: table.id,
      table_number: table.table_number,
      started_at: startedAt
    });
    moves.push({
      table_number: table.table_number,
      dealer_name: dealer.name || dealerName || 'Dealer',
      replaced: onTarget?.dealer_name || null
    });
  } else {
    // push_all: everyone advances one table in ascending table order, and the
    // dealer on the last table wraps to the first. Empty slots stay empty
    // rather than being silently filled, so the floor sees the hole.
    const n = tables.length;
    if (n === 1) {
      // With one table a push has nowhere to go, and re-inserting the same
      // dealer would reset their down time and hide an overdue push.
      return res.status(400).json({
        success: false,
        error: {
          code: 'SINGLE_TABLE',
          message: 'Only One Table Is Assigned. Use Bring A Dealer In To Change Who Is Down.'
        }
      });
    }
    if (rotations.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_DEALERS_DOWN',
          message: 'No Dealers Are Currently On This Tournament\'s Tables. Assign Dealers Before Pushing.'
        }
      });
    }

    await endRotations(supabase, rotations);

    tables.forEach((t, i) => {
      const from = byTable.get(tables[(i - 1 + n) % n].id);
      if (!from) return;
      inserts.push({
        venue_id: tournament.venue_id,
        dealer_id: from.dealer_id,
        dealer_name: from.dealer_name || 'Dealer',
        table_id: t.id,
        table_number: t.table_number,
        started_at: startedAt
      });
      moves.push({
        table_number: t.table_number,
        dealer_name: from.dealer_name || 'Dealer',
        from_table_number: from.table_number
      });
    });
  }

  if (inserts.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'NOTHING_TO_PUSH', message: 'There Was Nothing To Push.' }
    });
  }

  const { error: insertErr } = await supabase
    .from('commander_dealer_rotations')
    .insert(inserts);

  if (insertErr) {
    console.error('[tournaments/dealers] rotation insert failed', {
      tournament_id: tournament.id, rows: inserts.length,
      code: insertErr.code, message: insertErr.message, details: insertErr.details,
    });
    return res.status(500).json({
      success: false,
      error: {
        code: 'DB_ERROR',
        message: 'The Old Rotations Were Closed But The New Ones Could Not Be Written. Re-Assign The Dealers On The Rotation Screen.'
      }
    });
  }

  await logAction({ action: 'push_tournament_dealers', category: 'tournament' }, {
    venueId: tournament.venue_id,
    staffId: staff.id,
    targetId: tournament.id,
    targetType: 'commander_tournaments',
    targetName: tournament.name || 'Tournament',
    metadata: { tournament_id: tournament.id, action, forced: force || undefined, moves },
    req
  });

  return res.status(200).json({
    success: true,
    data: {
      moves,
      forced_during_break: (force && clockState.on_break) || undefined,
      message: action === 'push_all'
        ? `${moves.length.toLocaleString()} Dealer${moves.length === 1 ? '' : 's'} Pushed One Table.`
        : `${moves[0].dealer_name} Is Now On Table ${moves[0].table_number}.`
    }
  });
}
