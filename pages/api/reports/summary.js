/**
 * Reports Summary API
 * GET /api/commander/reports/summary?range=today|week|month|quarter
 * Returns aggregate stats for the reports dashboard
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';
import { verifyStaffSession } from '../../../src/lib/commander/auth';
import { businessDayRange, isDateKey, reportRangeStartISO } from '../../../src/lib/commander/businessDate';
import { fetchVenueTimeZone } from '../../../src/lib/commander/venueTimeZone';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

/**
 * Report window. 'today' starts at the venue's business-day midnight (it was
 * the server's midnight: UTC on Vercel). `date` (YYYY-MM-DD) with 'today'
 * reports that whole venue day: the Daily Summary page sends it, and it used
 * to be ignored, so every past day showed today's numbers.
 */
function getDateRange(range, timeZone, date) {
  const now = new Date();
  if (range === 'today' && isDateKey(date)) return businessDayRange(date, timeZone);
  return { start: reportRangeStartISO(range, timeZone, now), end: now.toISOString() };
}

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization Required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid Token' });

      const { range = 'today', date } = req.query;

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
      if (!staffVenueId) return res.status(403).json({ success: false, error: 'Staff Access Required' });
      const staff = { venue_id: staffVenueId };
      const { start, end } = getDateRange(range, await fetchVenueTimeZone(getSupabase(), staffVenueId), date);

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
      return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
}
