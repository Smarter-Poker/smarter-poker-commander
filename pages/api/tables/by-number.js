/**
 * Table Detail API (by table number)
 * GET /api/commander/tables/by-number?tableNumber=N - Get table with seats/players
 * Moved from [tableNumber].js to avoid slug conflict with [id].js
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';
import { verifyStaffSession } from '../../../src/lib/commander/auth';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });

      // MULTI-CLUB FIX (2026-08-20): active venue from the HMAC-verified
      // staff session first; the old unscoped .maybeSingle() errored for
      // anyone with staff rows at 2+ venues (every multi-club owner).
      let staff = null;
      try {
        const sessionResult = await verifyStaffSession(req);
        if (sessionResult.staff?.venue_id) staff = { venue_id: sessionResult.staff.venue_id };
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
      if (!staff) {
        const { data: staffRow } = await getSupabase()
          .from('commander_staff')
          .select('venue_id')
          .or(`user_id.eq.${user.id},linked_user_id.eq.${user.id}`)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        staff = staffRow || null;
      }
      if (!staff) return res.status(403).json({ success: false, error: 'Staff access required' });

      const { tableNumber } = req.query;


      if (req.method === 'GET') {
        // Get table
        const { data: table } = await getSupabase()
          .from('commander_tables')
          .select('*')
          .eq('venue_id', staff.venue_id)
          .eq('table_number', parseInt(tableNumber))
          .maybeSingle();

        if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

        // Get seats
        const { data: seats } = await getSupabase()
          .from('commander_table_seats')
          .select('*')
          .eq('venue_id', staff.venue_id)
          .eq('table_number', parseInt(tableNumber))
          .order('seat_number');

        // If tournament mode, fetch tournament info
        let tournament = null;
        if (table.tournament_id) {
          const { data: t } = await getSupabase()
            .from('commander_tournaments')
            .select('id, name, status, game_type, buyin_amount')
            .eq('id', table.tournament_id)
            .maybeSingle();
          tournament = t;
        }

        // If cash mode, fetch active game info (must-move status)
        let game = null;
        if (table.mode === 'cash') {
          const { data: g } = await getSupabase()
            .from('commander_games')
            .select('id, game_type, stakes, status, is_must_move, parent_game_id')
            .eq('table_id', table.id)
            .in('status', ['waiting', 'running'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          game = g || null;
        }

        return res.status(200).json({
          success: true,
          data: {
            ...table,
            seats: seats || [],
            tournament: tournament || null,
            game: game || null
          }
        });
      }

      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Table detail error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
