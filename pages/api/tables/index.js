/**
 * Commander Tables API - GET/POST /api/commander/tables
 * List tables or create new table
 * Reference: Phase 2 - Table CRUD
 *
 * DEAD COLUMNS - DO NOT TRUST (documented 2026-08-20)
 * ---------------------------------------------------
 * `commander_tables.occupied_seats` and `commander_tables.player_count` are
 * real columns with a default of 0, and this route returns them because it
 * selects `*`. Nothing in this codebase writes either one, and production
 * already proves they have drifted: ten rows carry non-zero values and on most
 * of them the two columns disagree with each other (occupied_seats 3 alongside
 * player_count 5 on the same table).
 *
 * They are deliberately NOT maintained. A denormalised seat count fed from
 * every seating path (seat.js, seat-draw.js, the claim-seat RPC, table breaks,
 * eliminations, cash sit-downs) is exactly how a counter drifts, and there is
 * no single write path to hang it on. The columns are left in place rather
 * than dropped so no deploy can race a schema change.
 *
 * Live occupancy comes from rows, not counters:
 *   - cash:       commander_table_seats where status = 'occupied'
 *                 (merged onto each table below as `seats`)
 *   - tournament: commander_tournament_entries with a table_number/seat_number
 *                 and status in ('seated','active') - see
 *                 pages/api/tournaments/[id]/tables.js
 *
 * If you need a count, derive it. Do not read these two columns.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
import { logAction, AuditActions } from '../../../src/lib/commander/audit';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // 2026-08-20 audit fix: was guardWriteStaff, which returns `true` for GET
    // without verifying anything - the table list embeds occupied seats with
    // player_name, so any venue's floor and seated players were public.
    const _authResult = await guardStaff(req, res);
    if (!_authResult) return;

    switch (req.method) {
      case 'GET':
        return handleGet(req, res, _authResult);
      case 'POST':
        return handlePost(req, res, _authResult);
      default:
        return res.status(405).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
        });
    }

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// 2026-08-20 audit fix: venue_id was taken from the client with no check
// against the caller's staff session on any method.
function venueMismatch(staff, venueId) {
  if (!staff || staff === true) return false;
  if (staff.venue_id === undefined || staff.venue_id === null) return false;
  return String(staff.venue_id) !== String(venueId);
}

async function handleGet(req, res, staff) {
  try {
    const { venue_id, status } = req.query;

    if (!venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'venue_id is required' }
      });
    }

    if (venueMismatch(staff, venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' }
      });
    }

    // Try with game + seats join first, fallback to simple query
    let data, error;
    try {
      const result = await getSupabase()
        .from('commander_tables')
        .select(`
          *,
          commander_games!commander_games_table_id_fkey (
            id,
            game_type,
            stakes,
            status,
            current_players,
            max_players
          )
        `)
        .eq('venue_id', venue_id)
        .order('table_number', { ascending: true });

      if (result.error) throw result.error;
      data = result.data;

      // Also fetch seat occupancy data. This is the ONLY trustworthy cash-side
      // occupancy source on this route (see the dead-column note at the top).
      // 2026-08-20 audit fix: the limit was 100, which is fewer rows than a
      // 12-table room fills. The truncated tail silently read as empty seats,
      // so the lobby board under-counted a busy room.
      try {
        const { data: seats } = await getSupabase()
          .from('commander_table_seats')
          .select('table_number, seat_number, status, player_name, seated_at')
          .eq('venue_id', venue_id)
          .eq('status', 'occupied')
          .limit(5000);
        // Merge seats into table data
        if (seats && data) {
          const seatsByTable = {};
          seats.forEach(s => {
            if (!seatsByTable[s.table_number]) seatsByTable[s.table_number] = [];
            seatsByTable[s.table_number].push(s);
          });
          data = data.map(t => ({ ...t, seats: seatsByTable[t.table_number] || [] }));
        }
      } catch { /* seats table may not exist yet - non-critical */ }

      // 2026-08-20: commander_table_seats is sparse in practice (8 rows in
      // production against 92 live sessions), so a lobby board derived from it
      // alone advertises a nearly empty room. commander_table_sessions IS
      // maintained on every seat-in and unseat, so it is the trustworthy
      // headcount for cash tables. Exposed as seated_count alongside the seat
      // array, which stays authoritative for WHICH seats are taken when it has
      // rows.
      try {
        const { data: liveSessions } = await getSupabase()
          .from('commander_table_sessions')
          .select('table_number')
          .eq('venue_id', venue_id)
          .eq('status', 'active')
          .limit(5000);
        if (liveSessions && data) {
          const countByTable = {};
          liveSessions.forEach(s => {
            countByTable[s.table_number] = (countByTable[s.table_number] || 0) + 1;
          });
          data = data.map(t => ({
            ...t,
            seated_count: Math.max(
              countByTable[t.table_number] || 0,
              Array.isArray(t.seats) ? t.seats.length : 0
            )
          }));
        }
      } catch (e) {
        console.warn('[tables] live session count failed (non-critical):', e?.message || e);
      }

      // Fetch tournament details for tournament tables
      try {
        const tournamentIds = [...new Set((data || []).filter(t => t.tournament_id).map(t => t.tournament_id))];
        if (tournamentIds.length > 0) {
          const { data: tournaments } = await getSupabase()
            .from('commander_tournaments')
            .select('id, name, status, buyin_amount, buyin_fee, current_level, players_remaining, current_entries, starting_chips, tournament_type')
            .in('id', tournamentIds)
            .limit(100);
          if (tournaments) {
            const tournMap = Object.fromEntries(tournaments.map(t => [t.id, t]));
            data = data.map(t => t.tournament_id ? { ...t, tournament: tournMap[t.tournament_id] || null } : t);
          }
        }
      } catch { /* tournament join non-critical */ }
    } catch {
      // Fallback: simple query without FK join
      const result = await getSupabase()
        .from('commander_tables')
        .select('*')
        .eq('venue_id', venue_id)
        .order('table_number', { ascending: true })
        .limit(100)
      data = result.data;
      error = result.error;
    }

    if (status) {
      data = (data || []).filter(t => t.status === status);
    }

    if (error) {
      console.warn('Commander tables query error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch tables' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { tables: data || [] }
    });
  } catch (error) {
    console.warn('Commander tables GET error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}

async function handlePost(req, res, _authResult) {
  try {
    // Note: guardWriteStaff is already called in the main handler (line 21)
    // so staff auth is already validated. No need for a redundant check here.

    const {
      venue_id,
      table_number,
      table_name,
      max_seats = 9,
      features = {},
      position_x,
      position_y,
      game_type,
      stakes
    } = req.body;

    if (!venue_id || !table_number) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'venue_id and table_number are required' }
      });
    }

    if (venueMismatch(_authResult, venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' }
      });
    }

    // Check if table number already exists at venue
    const { data: existing } = await getSupabase()
      .from('commander_tables')
      .select('id')
      .eq('venue_id', venue_id)
      .eq('table_number', table_number)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Table number already exists at this venue' }
      });
    }

    const insertData = {
      venue_id,
      table_number,
      table_name: table_name || `Table ${table_number}`,
      max_seats,
      status: 'available',
      features,
      position_x,
      position_y
    };
    if (game_type) insertData.game_type = game_type.toUpperCase();
    if (stakes) insertData.stakes = stakes;

    const { data: table, error } = await getSupabase()
      .from('commander_tables')
      .insert(insertData)
      .select()
      .maybeSingle();

    if (error) {
      console.warn('Commander table create error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to create table' }
      });
    }

    if (!table) return res.status(500).json({ success: false, error: 'Failed to create table' });

    // Audit log
    if (_authResult && _authResult.id) {
      await logAction(AuditActions.TABLE_CREATE, {
        venueId: venue_id,
        staffId: _authResult.id,
        targetId: table.id,
        targetType: 'commander_tables',
        targetName: insertData.table_name,
        metadata: { max_seats, game_type, stakes },
        req
      });
    }

    return res.status(201).json({
      success: true,
      data: { table }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Commander tables POST error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  }
}
