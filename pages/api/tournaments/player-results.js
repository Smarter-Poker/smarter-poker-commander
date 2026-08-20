/**
 * Player Tournament Results API
 * GET /api/commander/tournaments/player-results?member_id=xxx
 * Returns tournament results for a specific member, matched by name
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    if (req.method !== 'GET') {
      return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
    }

    const { member_id } = req.query;
    if (!member_id) {
      return res.status(400).json({ success: false, error: { message: 'member_id is required' } });
    }

    try {
      // Get member info
      const { data: member, error: memberErr } = await getSupabase()
        .from('commander_members')
        .select('first_name, last_name, venue_id')
        .eq('id', member_id)
        .maybeSingle();

      if (memberErr || !member) {
        return res.status(404).json({ success: false, error: { message: 'Member not found' } });
      }

      const fullName = `${member.first_name} ${member.last_name}`;

      // Query tournament entries by player_name matching
      const { data: entries, error: entriesErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select(`
          id,
          tournament_id,
          player_name,
          status,
          finish_position,
          payout_amount,
          payout_position,
          rebuy_count,
          addon_taken,
          total_invested,
          eliminated_at,
          registered_at,
          commander_tournaments (
            id,
            name,
            buyin_amount,
            scheduled_start,
            status,
            venue_id
          )
        `)
        .ilike('player_name', fullName)
        .order('registered_at', { ascending: false })
        .limit(50);

      if (entriesErr) {
        console.warn('Tournament results query error:', entriesErr);
        return res.status(500).json({ success: false, error: { message: 'Failed to fetch results' } });
      }

      // Filter to venue and format results
      const results = (entries || [])
        .filter(e => e.commander_tournaments?.venue_id === member.venue_id)
        .map(e => ({
          id: e.id,
          tournament_name: e.commander_tournaments?.name,
          date: e.commander_tournaments?.scheduled_start || e.registered_at,
          buyin_amount: e.commander_tournaments?.buyin_amount || 0,
          finish_position: e.finish_position,
          payout: e.payout_amount || 0,
          status: e.status,
          rebuys: e.rebuy_count || 0,
          addon: e.addon_taken || false,
          total_invested: e.total_invested || 0
        }));

      return res.status(200).json({ success: true, data: results });
    } catch (error) {
      console.warn('Player results error:', error);
      return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
