/**
 * Marketplace Dealers API
 * GET /api/commander/marketplace/dealers - List available freelance dealers
 * POST /api/commander/marketplace/dealers - Register as freelance dealer
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
      return listDealers(req, res);
    }

    if (req.method === 'POST') {
      return registerDealer(req, res);
    }

    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
    });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listDealers(req, res) {
  try {
    const {
      area,
      game,
      min_rating,
      verified_only,
      limit = 20,
      offset = 0
    } = req.query;

    // 2026-04-28 fix: PostgREST embedded select `profiles:dealer_id (...)` requires
    // a foreign key from commander_dealer_marketplace.dealer_id → profiles.id.
    // That FK doesn't exist in production schema (verified via information_schema),
    // so the embed throws PGRST200 / "Could not find a relationship" → 500.
    // Dropped the embed; consumers can fetch profile metadata separately if needed.
    let query = getSupabase()
      .from('commander_dealer_marketplace')
      .select('*', { count: 'exact' })
      .eq('status', 'active')
      .order('rating', { ascending: false, nullsFirst: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (area) {
      query = query.contains('service_area', [area])
          .limit(100);
    }

    if (game) {
      query = query.contains('games_offered', [game]);
    }

    if (min_rating) {
      query = query.gte('rating', parseFloat(min_rating));
    }

    if (verified_only === 'true') {
      query = query.eq('verified', true);
    }

    const { data, error, count } = await query;

    if (error) {
      // Missing-table guard - migration archived at
      // supabase/migrations/archive/20260127_commander_remaining_tables.sql,
      // never applied to production. Return empty list with clear flag.
      if (error.code === '42P01' || /relation .* does not exist/i.test(error.message || '')) {
        console.warn('[marketplace/dealers] commander_dealer_marketplace table not provisioned; returning empty list');
        return res.status(200).json({
          success: true,
          data: { dealers: [], total: 0, limit: parseInt(limit), offset: parseInt(offset) },
          feature_disabled: true,
          reason: 'commander_dealer_marketplace table not provisioned in this Supabase project',
        });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      data: {
        dealers: data || [],
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.warn('List dealers error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to list dealers' }
    });
  }
}

async function registerDealer(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authorization required' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
      });
    }

    const {
      name,
      service_area,
      hourly_rate,
      games_offered,
      experience_years,
      bio,
      available_days,
      contact_email,
      contact_phone
    } = req.body;

    if (!name || !service_area || !games_offered) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'name, service_area, and games_offered required' }
      });
    }

    // Check if already registered
    const { data: existing } = await getSupabase()
      .from('commander_dealer_marketplace')
      .select('id')
      .eq('dealer_id', user.id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_REGISTERED', message: 'You are already registered as a dealer' }
      });
    }

    const { data: dealer, error } = await getSupabase()
      .from('commander_dealer_marketplace')
      .insert({
        dealer_id: user.id,
        name,
        service_area,
        hourly_rate,
        games_offered,
        experience_years,
        bio,
        available_days,
        contact_email: contact_email || user.email,
        contact_phone,
        status: 'active',
        verified: false
      })
      // 2026-07-25 audit fix: dropped the `profiles:dealer_id (...)` embed - the
      // FK it requires doesn't exist (PGRST200 after the row was inserted; same
      // issue as the listDealers fix above). Plain select of the inserted row.
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      data: { dealer }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Register dealer error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to register dealer' }
    });
  }
}
