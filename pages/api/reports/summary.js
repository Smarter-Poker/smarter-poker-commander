/**
 * Reports Summary API
 * GET /api/commander/reports/summary?range=today|week|month|quarter
 * Returns aggregate stats for the reports dashboard
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';
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

function getDateRange(range) {
  const now = new Date();
  const start = new Date();
  switch (range) {
    case 'today': start.setHours(0, 0, 0, 0); break;
    case 'week': start.setDate(now.getDate() - 7); break;
    case 'month': start.setMonth(now.getMonth() - 1); break;
    case 'quarter': start.setMonth(now.getMonth() - 3); break;
    default: start.setHours(0, 0, 0, 0);
  }
  return { start: start.toISOString(), end: now.toISOString() };
}

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });

      const { range = 'today' } = req.query;
      const { start, end } = getDateRange(range);

      // MULTI-CLUB FIX (2026-08-20): resolve the ACTIVE venue from the
      // HMAC-verified staff session first — it pins the venue the user
      // actually switched to. The old path took "the user's first staff
      // row / first subscription", which errored (multi-row maybeSingle)
      // or reported the WRONG venue for multi-club owners and multi-venue
      // staff.
      let staffVenueId = null;
      try {
        const sessionResult = await verifyStaffSession(req);
        if (sessionResult.staff?.venue_id) staffVenueId = sessionResult.staff.venue_id;
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

      if (!staffVenueId) {
        // Legacy fallback for callers without a signed session header
        const { data: staffRow } = await getSupabase()
          .from('commander_staff')
          .select('venue_id')
          .or(`user_id.eq.${user.id},linked_user_id.eq.${user.id}`)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        if (staffRow) {
          staffVenueId = staffRow.venue_id;
        } else {
          const { data: sub } = await getSupabase()
            .from('commander_subscriptions')
            .select('venue_id')
            .eq('owner_id', user.id)
            .in('status', ['active', 'trialing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (sub) staffVenueId = sub.venue_id;
        }
      }
      if (!staffVenueId) return res.status(403).json({ success: false, error: 'Staff access required' });
      const staff = { venue_id: staffVenueId };

      // Tournament stats
      const { data: tournaments } = await getSupabase()
        .from('commander_tournaments')
        .select('id, status, buyin_amount, actual_prizepool')
        .eq('venue_id', staff.venue_id)
        .gte('created_at', start)
        .lte('created_at', end);

      const tournamentsRun = (tournaments || []).filter(t => ['completed', 'running', 'final_table'].includes(t.status)).length;

      // Tournament entries for player count
      const tournamentIds = (tournaments || []).map(t => t.id);
      let totalEntries = 0;
      if (tournamentIds.length > 0) {
        const { count } = await getSupabase()
          .from('commander_tournament_entries')
          .select('id', { count: 'exact', head: true })
          .in('tournament_id', tournamentIds)
        totalEntries = count || 0;
      }

      // Tables
      const { data: tablesData } = await getSupabase()
        .from('commander_tables')
        .select('id')
        .eq('venue_id', staff.venue_id)

      // Estimate table hours (tables * hours since start)
      const hoursSinceStart = Math.min((new Date() - new Date(start)) / 3600000, 24);
      const tableHours = Math.round((tablesData?.length || 0) * hoursSinceStart * 0.6); // 60% utilization estimate

      // Revenue estimate
      const revenue = (tournaments || []).reduce((sum, t) => sum + (t.actual_prizepool || t.buyin_amount || 0), 0);

      return res.status(200).json({
        success: true,
        data: {
          total_players: totalEntries,
          table_hours: tableHours,
          tournaments_run: tournamentsRun,
          revenue,
          date_range: { start, end, label: range }
        }
      });
    } catch (err) {
      console.warn('Reports summary error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
