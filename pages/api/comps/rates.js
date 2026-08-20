/**
 * Comp Rates API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/comps/rates - List comp rates for venue
 * POST /api/commander/comps/rates - Create comp rate
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
      return listRates(req, res);
    }

    if (req.method === 'POST') {
      return createRate(req, res);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listRates(req, res) {
  try {
    const { venue_id, active_only = 'true' } = req.query;

    // If no venue_id, return a default rate for display purposes
    if (!venue_id) {
      // Get any default rates for display
      const { data: defaultRates } = await getSupabase()
        .from('commander_comp_rates')
        .select('comp_value')
        .eq('is_default', true)
        .eq('is_active', true)
        .eq('rate_type', 'hourly')
        .limit(1);

      const ratePerHour = defaultRates?.[0]?.comp_value || 1;

      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
        success: true,
        data: {
          rates: [],
          rate_per_hour: ratePerHour
        }
      });
    }

    let query = getSupabase()
      .from('commander_comp_rates')
      .select('*')
      .eq('venue_id', venue_id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
          .limit(100);

    if (active_only === 'true') {
      query = query.eq('is_active', true)
          .limit(100);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Find the default hourly rate
    const defaultRate = data?.find(r => r.is_default && r.rate_type === 'hourly');
    const ratePerHour = defaultRate?.comp_value || 1;

    return res.status(200).json({
      success: true,
      data: {
        rates: data,
        rate_per_hour: ratePerHour
      }
    });
  } catch (error) {
    console.warn('List comp rates error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Internal server error' }
    });
  }
}

async function createRate(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const { venue_id } = req.body;

    if (!venue_id) {
      return res.status(400).json({ success: false, error: 'Venue ID required' });
    }

    // Check if user is manager/owner at this venue
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', venue_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'manager', 'dualrate'])
      .eq('is_active', true)
      .maybeSingle();

    if (!staff) {
      return res.status(403).json({ success: false, error: 'Manager or owner role required' });
    }

    const {
      name,
      description,
      rate_type,
      comp_value,
      per_unit = 1,
      unit_label,
      min_stakes,
      game_types,
      min_session_hours,
      weekday_multiplier = 1.0,
      weekend_multiplier = 1.0,
      happy_hour_multiplier = 1.0,
      vip_multiplier = 1.0,
      is_active = true,
      is_default = false
    } = req.body;

    if (!name || !rate_type || !comp_value) {
      return res.status(400).json({ success: false, error: 'Name, rate type, and comp value are required' });
    }

    // If setting as default, unset other defaults
    if (is_default) {
      await getSupabase()
        .from('commander_comp_rates')
        .update({ is_default: false })
        .eq('venue_id', venue_id)
        .eq('rate_type', rate_type);
    }

    const { data: rate, error } = await getSupabase()
      .from('commander_comp_rates')
      .insert({
        venue_id: venue_id,
        name,
        description,
        rate_type,
        comp_value,
        per_unit,
        unit_label,
        min_stakes,
        game_types,
        min_session_hours,
        weekday_multiplier,
        weekend_multiplier,
        happy_hour_multiplier,
        vip_multiplier,
        is_active,
        is_default
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(201).json({ rate });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Create comp rate error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
