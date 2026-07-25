/**
 * Member Hours API
 * GET /api/commander/members/hours?venue_id=...
 * 
 * Aggregates total hours played per member from commander_player_sessions.
 * Falls back to visit_count * estimated average session length if no sessions exist.
 * Returns ranked list of members by total play time.
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

      const _g = await guardWriteStaff(req, res); if (!_g) return;

      if (req.method !== 'GET') {
          return res.status(405).json({ success: false, error: 'GET only' });
      }

      const { venue_id, period = 'all', limit = 50 } = req.query;
      if (!venue_id) {
          return res.status(400).json({ success: false, error: 'venue_id required' });
      }

      try {
          // ── 1. Try commander_player_sessions first ──
          // 2026-07-25 audit fix: column is check_in_at (check_in_time does not exist),
          // and the .limit(100) cap silently truncated the hours aggregation.
          let sessionQuery = getSupabase()
              .from('commander_player_sessions')
              .select('player_id, total_time_minutes, check_in_at, status')
              .eq('venue_id', venue_id)
              .eq('status', 'completed')

          // Apply period filter
          if (period !== 'all') {
              const now = new Date();
              let startDate;
              if (period === 'today') {
                  startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              } else if (period === 'week') {
                  startDate = new Date(now); startDate.setDate(startDate.getDate() - 7);
              } else if (period === 'month') {
                  startDate = new Date(now.getFullYear(), now.getMonth(), 1);
              } else if (period === 'year') {
                  startDate = new Date(now.getFullYear(), 0, 1);
              }
              if (startDate) {
                  // 2026-07-25 audit fix: check_in_at is the real column name.
                  sessionQuery = sessionQuery.gte('check_in_at', startDate.toISOString());
              }
          }

          const { data: sessions, error: sessError } = await sessionQuery;

          // Aggregate by player
          const playerHours = {};
          if (!sessError && sessions && sessions.length > 0) {
              sessions.forEach(s => {
                  if (!s.player_id) return;
                  if (!playerHours[s.player_id]) {
                      playerHours[s.player_id] = { totalMinutes: 0, sessionCount: 0 };
                  }
                  playerHours[s.player_id].totalMinutes += (s.total_time_minutes || 0);
                  playerHours[s.player_id].sessionCount++;
              });
          }

          // ── 2. Enrich with member data ──
          const { data: members } = await getSupabase()
              .from('commander_members')
              .select('id, first_name, last_name, member_number, photo_url, visit_count, last_checkin, membership_tier, created_at')
              .eq('venue_id', venue_id)
              .eq('membership_status', 'active')
              .order('visit_count', { ascending: false })
              .limit(Math.min(parseInt(limit) || 50, 500));

          // ── 3. Build ranked list ──
          const ranked = (members || []).map(m => {
              const sess = playerHours[m.id] || null;
              // If we have session data, use it. Otherwise estimate from visit count.
              const totalMinutes = sess ? sess.totalMinutes : (m.visit_count || 0) * 180; // 3hr avg estimate
              const sessionCount = sess ? sess.sessionCount : (m.visit_count || 0);
              const totalHours = Math.round((totalMinutes / 60) * 10) / 10; // 1 decimal

              return {
                  member_id: m.id,
                  first_name: m.first_name,
                  last_name: m.last_name,
                  member_number: m.member_number,
                  photo_url: m.photo_url,
                  membership_tier: m.membership_tier,
                  visit_count: m.visit_count || 0,
                  last_checkin: m.last_checkin,
                  created_at: m.created_at,
                  total_hours: totalHours,
                  total_minutes: totalMinutes,
                  session_count: sessionCount,
                  has_session_data: !!sess,
              };
          })
              .filter(m => m.total_hours > 0 || m.visit_count > 0)
              .sort((a, b) => b.total_hours - a.total_hours)
              .map((m, i) => ({ ...m, rank: i + 1 }));

          return res.status(200).json({
              success: true,
              data: {
                  players: ranked.slice(0, parseInt(limit)),
                  total: ranked.length,
                  period,
                  has_session_data: ranked.some(r => r.has_session_data),
              }
          });

      } catch (err) {
          console.warn('[Hours API] Error:', err);
          // If commander_player_sessions table doesn't exist, fall back to visit_count estimate
          try {
              const { data: members } = await getSupabase()
                  .from('commander_members')
                  .select('id, first_name, last_name, member_number, photo_url, visit_count, last_checkin, membership_tier, created_at')
                  .eq('venue_id', venue_id)
                  .eq('membership_status', 'active')
                  .gt('visit_count', 0)
                  .order('visit_count', { ascending: false })
                  .limit(Math.min(parseInt(limit) || 50, 500));

              const ranked = (members || []).map((m, i) => ({
                  member_id: m.id,
                  first_name: m.first_name,
                  last_name: m.last_name,
                  photo_url: m.photo_url,
                  membership_tier: m.membership_tier,
                  visit_count: m.visit_count || 0,
                  total_hours: Math.round(((m.visit_count || 0) * 3) * 10) / 10,
                  total_minutes: (m.visit_count || 0) * 180,
                  session_count: m.visit_count || 0,
                  has_session_data: false,
                  rank: i + 1,
              }));

              return res.status(200).json({
                  success: true,
                  data: { players: ranked, total: ranked.length, period, has_session_data: false }
              });
          } catch (fallbackErr) {
              return res.status(500).json({ success: false, error: 'Failed to fetch hours data' });
          }
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
