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

// Auth: STAFF_WRITE — requires manager or owner role
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

    let query = getSupabase()
      .from('commander_equipment_rentals')
      .select(`
        *,
        profiles:vendor_id (id, display_name, avatar_url)
      `, { count: 'exact' })
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

    if (error) throw error;

    // Get unique categories for filtering
    const { data: categories } = await getSupabase()
      .from('commander_equipment_rentals')
      .select('category')
      .eq('available', true)
          .limit(100);

    const uniqueCategories = [...new Set(categories?.map(c => c.category).filter(Boolean))]
        .limit(100);

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
      .select(`
        *,
        profiles:vendor_id (id, display_name, avatar_url)
      `)
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
