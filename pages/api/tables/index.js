/**
 * Commander Tables API - GET/POST /api/commander/tables
 * List tables or create new table
 * Reference: Phase 2 - Table CRUD
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
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

async function handleGet(req, res) {
  try {
    const { venue_id, status } = req.query;

    if (!venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'venue_id is required' }
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

      // Also fetch seat occupancy data
      try {
        const { data: seats } = await getSupabase()
          .from('commander_table_seats')
          .select('table_number, seat_number, status, player_name, seated_at')
          .eq('venue_id', venue_id)
          .eq('status', 'occupied')
          .limit(100);
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
