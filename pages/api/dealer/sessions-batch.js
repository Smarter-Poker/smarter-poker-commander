/**
 * Batch Dealer Table Sessions API
 * GET /api/commander/dealer/sessions-batch?tables=1,2,3&venue_id=X
 * 
 * Returns active sessions for MULTIPLE tables in a single query.
 * This eliminates the N+1 problem where table-tablets.js would fire
 * one /api/commander/dealer/sessions?table=X per active table.
 * 
 * Response: { success: true, data: { "1": [...sessions], "2": [...sessions] } }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

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

      const { tables, venue_id } = req.query;

      if (!tables || !venue_id) {
          return res.status(400).json({ success: false, error: 'tables and venue_id parameters are required' });
      }

      const tableNumbers = tables.split(',').map(t => parseInt(t.trim())).filter(n => !isNaN(n));
      if (tableNumbers.length === 0) {
          return res.status(400).json({ success: false, error: 'No valid table numbers provided' });
      }

      try {
          // Single query for ALL table sessions
          let query = getSupabase()
              .from('commander_table_sessions')
              .select('*')
              .in('table_number', tableNumbers)
              .in('status', ['active', 'paused', 'meal_break'])
              .order('seat_number', { ascending: true })
              .eq('venue_id', venue_id);



          const { data: sessions, error } = await query;
          if (error) throw error;

          const now = new Date();

          // Batch-fetch member balances
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

          // Batch-fetch table modes to identify tournament tables
          let tournamentTableNums = new Set();
          if (tableNumbers.length > 0) {
              let tableQuery = getSupabase()
                  .from('commander_tables')
                  .select('table_number, mode, table_purpose')
                  .in('table_number', tableNumbers)
              if (venue_id) tableQuery = tableQuery.eq('venue_id', parseInt(venue_id));
              const { data: tableModes } = await tableQuery;
              (tableModes || []).forEach(t => {
                  if (t.mode === 'tournament' || t.table_purpose === 'tournament') {
                      tournamentTableNums.add(t.table_number);
                  }
              });
          }

          // Group sessions by table_number with enriched data
          const result = {};
          tableNumbers.forEach(num => { result[num] = []; });

          (sessions || []).forEach(s => {
              const isTournament = tournamentTableNums.has(s.table_number);
              const totalAllocatedSeconds = ((s.time_allocated_minutes || 0) + (s.time_added_minutes || 0)) * 60;
              // Billing freezes while paused/on meal break: subtract accumulated paused
              // minutes plus any still-open paused span from wall-clock elapsed time.
              const pausedSeconds = (s.total_paused_minutes || 0) * 60
                  + (s.paused_at ? Math.floor((now - new Date(s.paused_at)) / 1000) : 0);
              const elapsedSeconds = Math.max(0, Math.floor((now - new Date(s.started_at)) / 1000) - pausedSeconds);
              const timeRemaining = isTournament ? null : Math.max(0, totalAllocatedSeconds - elapsedSeconds);
              const member = memberMap[s.member_id] || null;

              const enriched = {
                  session_id: s.id,
                  member_id: s.member_id,
                  player_name: s.player_name,
                  table_number: s.table_number,
                  seat_number: s.seat_number,
                  session_status: s.status,
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
                  time_remaining: timeRemaining,
                  is_low: isTournament ? false : (timeRemaining <= 900 && timeRemaining > 0),
                  is_critical: isTournament ? false : (timeRemaining <= 300 && timeRemaining > 0),
                  is_expired: isTournament ? false : (timeRemaining <= 0)
              };

              if (!result[s.table_number]) result[s.table_number] = [];
              result[s.table_number].push(enriched);
          });

          return res.status(200).json({ success: true, data: result });
      } catch (err) {
          console.warn('Batch dealer sessions error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
