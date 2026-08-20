/**
 * Daily Analytics API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/analytics/daily - Get daily analytics
 * POST /api/commander/analytics/daily - Calculate/refresh daily analytics
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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method === 'GET') {
      return getDailyAnalytics(req, res);
    }

    if (req.method === 'POST') {
      return calculateDailyAnalytics(req, res);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getDailyAnalytics(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { venue_id, start_date, end_date, days = 30 } = req.query;

    if (!venue_id) {
      return res.status(400).json({ error: 'Venue ID required' });
    }

    // Check if user is manager/owner at this venue
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', venue_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'manager'])
      .eq('is_active', true)
      .maybeSingle();

    if (!staff) {
      return res.status(403).json({ error: 'Analytics access requires manager or owner role' });
    }

    let query = getSupabase()
      .from('commander_analytics_daily')
      .select('*')
      .eq('venue_id', venue_id)
      .order('date', { ascending: false });

    if (start_date && end_date) {
      query = query.gte('date', start_date).lte('date', end_date)
    } else {
      // Default to last N days
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      query = query.gte('date', startDate.toISOString().split('T')[0])
    }

    const { data, error } = await query;

    if (error) throw error;

    // Calculate summary stats
    const summary = data.reduce((acc, day) => {
      acc.total_sessions += day.total_sessions || 0;
      acc.unique_players += day.unique_players || 0;
      acc.total_play_hours += parseFloat(day.total_play_hours) || 0;
      acc.total_buyin += day.total_buyin || 0;
      acc.tournaments_run += day.tournaments_run || 0;
      acc.promotions_awarded += day.promotions_awarded || 0;
      return acc;
    }, {
      total_sessions: 0,
      unique_players: 0,
      total_play_hours: 0,
      total_buyin: 0,
      tournaments_run: 0,
      promotions_awarded: 0
    });

    // 2026-08-20 audit fix: venue-scoped, manager-only analytics must not sit
    // in a shared CDN cache where an unauthenticated request to the same URL
    // would be served the cached body.
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({
      analytics: data,
      summary,
      period: {
        start: data.length > 0 ? data[data.length - 1].date : null,
        end: data.length > 0 ? data[0].date : null,
        days: data.length
      }
    });
  } catch (error) {
    console.warn('Get daily analytics error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function calculateDailyAnalytics(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { venue_id, date } = req.body;

    if (!venue_id) {
      return res.status(400).json({ error: 'Venue ID required' });
    }

    // Check if user is manager/owner at this venue
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', venue_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'manager'])
      .eq('is_active', true)
      .maybeSingle();

    if (!staff) {
      return res.status(403).json({ error: 'Analytics access requires manager or owner role' });
    }

    const targetDate = date || new Date().toISOString().split('T')[0];

    // Calculate analytics from sessions
    const { data: sessions } = await getSupabase()
      .from('commander_player_sessions')
      .select('*')
      .eq('venue_id', venue_id)
      .gte('check_in_at', `${targetDate}T00:00:00`)
      .lt('check_in_at', `${targetDate}T23:59:59`)

    const { data: tournaments } = await getSupabase()
      .from('commander_tournaments')
      .select('*')
      .eq('venue_id', venue_id)
      .gte('scheduled_start', `${targetDate}T00:00:00`)
      .lt('scheduled_start', `${targetDate}T23:59:59`)

    const { data: awards } = await getSupabase()
      .from('commander_promotion_awards')
      .select('*')
      .eq('venue_id', venue_id)
      .gte('created_at', `${targetDate}T00:00:00`)
      .lt('created_at', `${targetDate}T23:59:59`)

    // Calculate metrics
    const uniquePlayers = new Set(sessions?.map(s => s.player_id).filter(Boolean))
    const totalMinutes = sessions?.reduce((sum, s) => sum + (s.total_time_minutes || 0), 0) || 0;
    const totalBuyin = sessions?.reduce((sum, s) => sum + (s.total_buyin || 0), 0) || 0;
    // Note: commander_player_sessions does not have total_cashout column
    const totalCashout = 0;

    const analytics = {
      venue_id: venue_id,
      date: targetDate,
      total_sessions: sessions?.length || 0,
      unique_players: uniquePlayers.size,
      total_play_hours: (totalMinutes / 60).toFixed(2),
      avg_session_hours: sessions?.length > 0 ? (totalMinutes / 60 / sessions.length).toFixed(2) : 0,
      total_buyin: totalBuyin,
      total_cashout: totalCashout,
      avg_buyin: sessions?.length > 0 ? Math.round(totalBuyin / sessions.length) : 0,
      tournaments_run: tournaments?.length || 0,
      tournament_entries: tournaments?.reduce((sum, t) => sum + (t.current_entries || 0), 0) || 0,
      promotions_awarded: awards?.length || 0,
      promotion_value_awarded: awards?.reduce((sum, a) => sum + (a.prize_value || 0), 0) || 0,
      calculated_at: new Date().toISOString()
    };

    const { data: result, error } = await getSupabase()
      .from('commander_analytics_daily')
      .upsert(analytics, { onConflict: 'venue_id,date' })
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({
      analytics: result,
      message: `Analytics calculated for ${targetDate}`
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Calculate daily analytics error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
