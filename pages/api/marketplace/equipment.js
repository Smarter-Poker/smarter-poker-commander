/**
 * Marketplace Equipment API
 * GET /api/commander/marketplace/equipment - List available equipment rentals
 * POST /api/commander/marketplace/equipment - List equipment for rent
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
      return listEquipment(req, res);
    }

    if (req.method === 'POST') {
      return listForRent(req, res);
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

async function listEquipment(req, res) {
  try {
    const {
      category,
      area,
      max_daily_rate,
      limit = 20,
      offset = 0
    } = req.query;

    // 2026-04-28 fix: PostgREST embedded select `profiles:vendor_id (...)` requires
    // a FK from commander_equipment_rentals.vendor_id → profiles.id, which doesn't
    // exist in production schema. The embed throws PGRST200 → 500. Removed.
    let query = getSupabase()
      .from('commander_equipment_rentals')
      .select('*', { count: 'exact' })
      .eq('available', true)
      .order('daily_rate', { ascending: true })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (category) {
      query = query.eq('category', category)
          .limit(100);
    }

    if (area) {
      query = query.contains('service_area', [area]);
    }

    if (max_daily_rate) {
      query = query.lte('daily_rate', parseFloat(max_daily_rate));
    }

    const { data, error, count } = await query;

    if (error) {
      // Missing-table guard - commander_equipment_rentals migration archived at
      // supabase/migrations/archive/20260127_commander_remaining_tables.sql,
      // never applied. Return empty list with feature_disabled flag.
      if (error.code === '42P01' || /relation .* does not exist/i.test(error.message || '')) {
        console.warn('[marketplace/equipment] commander_equipment_rentals table not provisioned; returning empty list');
        return res.status(200).json({
          success: true,
          data: { equipment: [], categories: [], total: 0, limit: parseInt(limit), offset: parseInt(offset) },
          feature_disabled: true,
          reason: 'commander_equipment_rentals table not provisioned in this Supabase project',
        });
      }
      throw error;
    }

    // Get unique categories for filtering
    const { data: categories } = await getSupabase()
      .from('commander_equipment_rentals')
      .select('category')
      .eq('available', true)
      .limit(100);

    // Array.prototype has no .limit() - slice to cap, in case the dataset is huge
    const uniqueCategories = [...new Set(categories?.map(c => c.category).filter(Boolean))].slice(0, 100);

    return res.status(200).json({
      success: true,
      data: {
        equipment: data || [],
        categories: uniqueCategories,
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.warn('List equipment error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to list equipment' }
    });
  }
}

async function listForRent(req, res) {
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
      description,
      category,
      daily_rate,
      weekly_rate,
      service_area,
      images,
      deposit_required
    } = req.body;

    if (!name || !category || !daily_rate) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'name, category, and daily_rate required' }
      });
    }

    // 2026-07-29 fix: the insert wrote description/weekly_rate/service_area/images/
    // deposit_required, none of which existed on commander_equipment_rentals (7-col
    // stub), so every POST failed with PGRST204 - the "list for rent" feature never
    // worked. The columns are added by migration 20260729_equipment_rentals_shape.sql.
    // The `profiles:vendor_id (...)` embed also required a FK that does not exist
    // (PGRST200), the same one already removed from the GET path above - dropped here.
    const { data: equipment, error } = await getSupabase()
      .from('commander_equipment_rentals')
      .insert({
        vendor_id: user.id,
        name,
        description,
        category,
        daily_rate,
        weekly_rate,
        service_area: service_area || [],
        images: images || [],
        deposit_required,
        available: true
      })
      .select('*')
      .maybeSingle();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      data: { equipment }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('List equipment for rent error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to list equipment' }
    });
  }
}
