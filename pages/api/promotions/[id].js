/**
 * Single Promotion API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/promotions/[id] - Get promotion details
 * PUT /api/commander/promotions/[id] - Update promotion
 * DELETE /api/commander/promotions/[id] - Delete promotion
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

    // 2026-08-20 audit fix: was guardWriteStaff, which returns `true` for GET
    // without verifying anything - the detail payload includes the internal
    // settings blob and the last ten awards with player names.
    const _g = await guardStaff(req, res); if (!_g) return;

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Promotion ID required' });
    }

    if (req.method === 'GET') {
      return getPromotion(req, res, id, _g);
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      return updatePromotion(req, res, id);
    }

    if (req.method === 'DELETE') {
      return deletePromotion(req, res, id);
    }

    res.setHeader('Allow', ['GET', 'PUT', 'PATCH', 'DELETE']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getPromotion(req, res, id, staff) {
  try {
    const { data: promotion, error } = await getSupabase()
      .from('commander_promotions')
      .select(`
        *,
        poker_venues:venue_id (id, name, city, state, address)
      `)
      .eq('id', id)
      .maybeSingle();

    if (error || !promotion) {
      return res.status(404).json({ success: false, error: 'Promotion not found' });
    }

    if (staff && staff !== true && staff.venue_id !== undefined && staff.venue_id !== null
        && String(staff.venue_id) !== String(promotion.venue_id)) {
      return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
    }

    // Get recent awards
    const { data: recentAwards } = await getSupabase()
      .from('commander_promotion_awards')
      .select(`
        id,
        player_name,
        prize_value,
        prize_description,
        status,
        created_at,
        profiles:player_id (id, display_name, avatar_url)
      `)
      .eq('promotion_id', id)
      .order('created_at', { ascending: false })
      .limit(10);

    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({
      promotion,
      recent_awards: recentAwards || []
    });
  } catch (error) {
    console.warn('Get promotion error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function updatePromotion(req, res, id) {
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

    // Get promotion to check venue
    const { data: existing } = await getSupabase()
      .from('commander_promotions')
      .select('venue_id')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Promotion not found' });
    }

    // Check if user is staff at this venue
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', existing.venue_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!staff) {
      return res.status(403).json({ success: false, error: 'You are not authorized to update this promotion' });
    }

    const updates = {};
    const allowedFields = [
      'name', 'description', 'promotion_type', 'promo_type', 'prize_type', 'prize_value',
      'prize_description', 'prize_amount', 'start_date', 'end_date', 'days_of_week',
      'days_active', 'start_time', 'end_time', 'frequency', 'is_recurring',
      'min_stakes', 'min_hours_played', 'min_buyin', 'game_types', 'qualifying_hands',
      'status', 'is_active', 'is_featured', 'image_url', 'terms_conditions',
      'settings', 'requirements'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (Object.keys(updates || {}).length === 0) {
      return res.status(400).json({ success: false, error: 'No updates provided' });
    }

    updates.updated_at = new Date().toISOString();

    const { data: promotion, error } = await getSupabase()
      .from('commander_promotions')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        poker_venues:venue_id (id, name)
      `)
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ success: true, data: { promotion } });
  } catch (error) {
    console.warn('Update promotion error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function deletePromotion(req, res, id) {
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

    // Get promotion to check venue
    const { data: existing } = await getSupabase()
      .from('commander_promotions')
      .select('venue_id')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Promotion not found' });
    }

    // Check if user is owner/manager at this venue
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', existing.venue_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'manager'])
      .eq('is_active', true)
      .maybeSingle();

    if (!staff) {
      return res.status(403).json({ success: false, error: 'Only owners and managers can delete promotions' });
    }

    const { error } = await getSupabase()
      .from('commander_promotions')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Promotion deleted' });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Delete promotion error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
