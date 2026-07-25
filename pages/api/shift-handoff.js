/**
 * Shift Handoff API
 * POST /api/commander/shift-handoff — Create new handoff (outgoing floor)
 * GET /api/commander/shift-handoff — List handoffs for venue
 * PATCH /api/commander/shift-handoff — Acknowledge handoff (incoming floor)
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method === 'POST') return createHandoff(req, res);
    if (req.method === 'GET') return listHandoffs(req, res);
    if (req.method === 'PATCH') return acknowledgeHandoff(req, res);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function createHandoff(req, res) {
  const { venue_id, staff_name, notes, issues, vip_alerts, pending_actions, incoming_staff_name } = req.body;

  if (!venue_id || !staff_name) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id and staff_name required' } });
  }

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    let userId = null;
    if (token) {
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      userId = user?.id;
    }

    // Snapshot current floor state
    // 2026-07-25 audit fix: snapshot queries used status values that are never
    // written — tables are 'in_use' when occupied, games are 'waiting'/'running',
    // and incidents use the incident_status column (there is no status column).
    const [tablesRes, waitlistRes, incidentsRes, gamesRes] = await Promise.all([
      getSupabase().from('commander_tables').select('id, table_number, table_name, status, current_game_type, current_stakes, max_seats').eq('venue_id', venue_id).eq('status', 'in_use'),
      getSupabase().from('commander_waitlist').select('id').eq('venue_id', venue_id).eq('status', 'waiting'),
      getSupabase().from('commander_incidents').select('id').eq('venue_id', venue_id).eq('incident_status', 'open'),
      getSupabase().from('commander_games').select('id, table_number, game_type, stakes, current_players, max_players, status').eq('venue_id', venue_id).in('status', ['waiting', 'running'])
    ]);

    const tables = tablesRes.data || [];
    const waitlist = waitlistRes.data || [];
    const incidents = incidentsRes.data || [];
    const games = gamesRes.data || [];

    // Calculate total active players from games
    const totalPlayers = games.reduce((sum, g) => sum + (g.current_players || 0), 0);

    // Build table snapshot with player counts from games
    const tableSnapshot = tables.map(t => {
      const game = games.find(g => String(g.table_number) === String(t.table_number));
      return {
        table_number: t.table_number,
        table_name: t.table_name,
        game: game ? `${game.game_type} ${game.stakes || ''}`.trim() : (t.current_game_type ? `${t.current_game_type} ${t.current_stakes || ''}`.trim() : 'No game'),
        players: game ? (game.current_players || 0) : 0,
        max_seats: game ? (game.max_players || t.max_seats || 9) : (t.max_seats || 9)
      };
    });

    const { data: handoff, error } = await getSupabase()
      .from('commander_shift_handoffs')
      .insert({
        venue_id,
        outgoing_staff_id: userId || '00000000-0000-0000-0000-000000000000',
        outgoing_staff_name: staff_name,
        incoming_staff_name: incoming_staff_name || null,
        shift_date: new Date().toISOString().split('T')[0],
        open_tables_count: tables.length,
        active_players_count: totalPlayers,
        waitlist_count: waitlist.length,
        open_incidents_count: incidents.length,
        notes: notes || null,
        issues: issues || null,
        vip_alerts: vip_alerts || null,
        pending_actions: pending_actions || null,
        table_snapshot: tableSnapshot
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(201).json({ success: true, data: { handoff } });
  } catch (error) {
    console.warn('Create handoff error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}

async function listHandoffs(req, res) {
  const { venue_id, limit = 20, status: filterStatus } = req.query;

  if (!venue_id) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'venue_id required' } });
  }

  try {
    let query = getSupabase()
      .from('commander_shift_handoffs')
      .select('*')
      .eq('venue_id', venue_id)
      .order('created_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 50, 500));

    if (filterStatus) query = query.eq('status', filterStatus);

    const { data: handoffs, error } = await query;
    if (error) throw error;

    return res.status(200).json({ success: true, data: { handoffs: handoffs || [] } });
  } catch (error) {
    console.warn('List handoffs error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}

async function acknowledgeHandoff(req, res) {
  const { handoff_id, staff_name } = req.body;

  if (!handoff_id || !staff_name) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'handoff_id and staff_name required' } });
  }

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    let userId = null;
    if (token) {
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      userId = user?.id;
    }

    const { data: handoff, error } = await getSupabase()
      .from('commander_shift_handoffs')
      .update({
        incoming_staff_id: userId || '00000000-0000-0000-0000-000000000000',
        incoming_staff_name: staff_name,
        acknowledged_at: new Date().toISOString(),
        status: 'acknowledged'
      })
      .eq('id', handoff_id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ success: true, data: { handoff } });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Acknowledge handoff error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
  }
}
