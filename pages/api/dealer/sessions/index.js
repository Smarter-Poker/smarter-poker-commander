/**
 * Dealer Table Sessions API
 * GET /api/commander/dealer/sessions?table=X
 * 
 * Returns active sessions for a table with calculated time_remaining.
 * time_remaining = (time_allocated + time_added) * 60 - elapsed_seconds
 * 
 * Both dealer tablet and player display poll this endpoint.
 * No auth guard - tablet is unauthenticated (same as other tablet endpoints).
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
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

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { table, venue_id } = req.query;

    if (!table || !venue_id) {
      return res.status(400).json({ success: false, error: 'table and venue_id parameters are required' });
    }

    const tableNum = parseInt(table);
    if (isNaN(tableNum)) {
      return res.status(400).json({ success: false, error: 'table must be a number' });
    }

    try {
      let query = getSupabase()
        .from('commander_table_sessions')
        .select('*')
        .eq('venue_id', venue_id)
        .eq('table_number', tableNum)
        .in('status', ['active', 'paused', 'meal_break'])
        .order('seat_number', { ascending: true });

      const { data: sessions, error } = await query;
      if (error) throw error;

      const now = new Date();

      // Batch-fetch member balances for sessions with member IDs
      const memberIds = [...new Set((sessions || []).filter(s => s.member_id).map(s => s.member_id))];
      let memberMap = {};
      if (memberIds.length > 0) {
        const { data: members } = await getSupabase()
          .from('commander_members')
          .select('id, time_balance_minutes, membership_tier, membership_status, membership_expires')
          .in('id', memberIds);
        if (members) {
          memberMap = Object.fromEntries(members.map(m => [m.id, m]));
        }
      }

      // Batch-fetch table modes to identify tournament tables (no timer for tournaments)
      const tableNums = [...new Set((sessions || []).map(s => s.table_number))];
      let tournamentTableNums = new Set();
      if (tableNums.length > 0) {
        let tableQuery = getSupabase()
          .from('commander_tables')
          .select('table_number, mode, table_purpose')
          .in('table_number', tableNums)
          .eq('venue_id', venue_id);
        const { data: tables } = await tableQuery;
        (tables || []).forEach(t => {
          if (t.mode === 'tournament' || t.table_purpose === 'tournament') {
            tournamentTableNums.add(t.table_number);
          }
        });
      }

      const withTimeRemaining = (sessions || []).map(s => {
        const isTournament = tournamentTableNums.has(s.table_number);
        const totalAllocatedSeconds = ((s.time_allocated_minutes || 0) + (s.time_added_minutes || 0)) * 60;
        const elapsedSeconds = Math.floor((now - new Date(s.started_at)) / 1000);
        const timeRemaining = isTournament ? null : Math.max(0, totalAllocatedSeconds - elapsedSeconds);
        const member = memberMap[s.member_id] || null;

        return {
          session_id: s.id,
          member_id: s.member_id,
          player_name: s.player_name,
          table_number: s.table_number,
          seat_number: s.seat_number,
          session_status: s.status, // 'active' | 'paused' | 'meal_break'
          membership_tier: member?.membership_tier || s.membership_tier,
          membership_status: member?.membership_status || null,
          membership_expires: member?.membership_expires || null,
          member_number: s.member_number,
          time_allocated_minutes: s.time_allocated_minutes,
          time_added_minutes: s.time_added_minutes,
          time_balance_minutes: member?.time_balance_minutes || 0,
          missed_blinds: s.missed_blinds || 0,
          started_at: s.started_at,
          is_tournament: isTournament,
          time_remaining: timeRemaining, // null for tournaments (no clock)
          is_low: isTournament ? false : (timeRemaining <= 900 && timeRemaining > 0),
          is_critical: isTournament ? false : (timeRemaining <= 300 && timeRemaining > 0),
          is_expired: isTournament ? false : (timeRemaining <= 0)
        };
      });

      return res.status(200).json({ success: true, data: withTimeRemaining });
    } catch (err) {
      console.warn('Dealer sessions error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
