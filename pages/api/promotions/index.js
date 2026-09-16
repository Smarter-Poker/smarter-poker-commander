/**
 * Promotions API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/promotions - List promotions
 * POST /api/commander/promotions - Create promotion
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // 2026-08-20 audit fix: was guardWriteStaff, which returns `true` for GET
    // without verifying anything - this listing includes draft and expired
    // promotions plus the internal `settings` blob and created_by. The public
    // player-facing view is /api/commander/promotions/active, which exposes
    // only display columns.
    const _g = await guardStaff(req, res); if (!_g) return;

    if (req.method === 'GET') {
      return listPromotions(req, res, _g);
    }

    if (req.method === 'POST') {
      return createPromotion(req, res);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listPromotions(req, res, staff) {
  try {
    const {
      venue_id,
      status = 'all',
      promotion_type,
      limit: rawLimit = '50',
      offset: rawOffset = '0'
    } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 500);
    const offset = parseInt(rawOffset) || 0;

    // Resolve integer venue_id: prefer query param if it's a valid integer,
    // otherwise look up from the authenticated user's staff record
    // 2026-08-20 audit fix: venue scope is pinned to the verified staff
    // session; a query venue_id is only honoured when it matches.
    if (venue_id && staff && staff !== true
        && staff.venue_id !== undefined && staff.venue_id !== null
        && String(staff.venue_id) !== String(venue_id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' } });
    }

    let resolvedVenueId = (staff && staff !== true && staff.venue_id !== undefined && staff.venue_id !== null)
      ? staff.venue_id
      : venue_id;
    if (!resolvedVenueId || isNaN(parseInt(resolvedVenueId))) {
      // Auto-resolve from auth
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const { data: authData } = await getSupabase().auth.getUser(token);
        const user = authData?.user;
        if (user) {
          // MULTI-CLUB FIX: limit(1) — unscoped maybeSingle errors for
          // users with staff rows at 2+ venues
          const { data: staff } = await getSupabase()
            .from('commander_staff')
            .select('venue_id')
            .or(`user_id.eq.${user.id},linked_user_id.eq.${user.id}`)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();
          if (staff) resolvedVenueId = staff.venue_id;
        }
      }
    }

    let query = getSupabase()
      .from('commander_promotions')
      .select(`
        *,
        poker_venues:venue_id (id, name, city, state)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (resolvedVenueId) {
      query = query.eq('venue_id', resolvedVenueId);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (promotion_type) {
      query = query.eq('promotion_type', promotion_type);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    // Auto-expire: batch-update any active promos past their end_date
    const now = new Date().toISOString().split('T')[0];
    const expiredIds = (data || []).filter(p => p.status === 'active' && p.end_date && p.end_date < now).map(p => p.id);
    if (expiredIds.length > 0) {
      await getSupabase().from('commander_promotions')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .in('id', expiredIds);
      // Reflect in response data
      data.forEach(p => { if (expiredIds.includes(p.id)) p.status = 'expired'; });
    }

    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({
      success: true,
      data: {
        promotions: data,
        total: count,
        limit,
        offset
      }
    });
  } catch (error) {
    console.warn('List promotions error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Internal server error' }
    });
  }
}

async function createPromotion(req, res) {
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

    // Check if user is staff at this venue
    let staff = null;
    const { data: staffRow } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', venue_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (staffRow) {
      staff = staffRow;
    } else {
      // Fallback: check if user is the venue owner via subscription
      const { data: sub } = await getSupabase()
        .from('commander_subscriptions')
        .select('id, venue_id, owner_id')
        .eq('owner_id', user.id)
        .eq('venue_id', venue_id)
        .in('status', ['active', 'trialing'])
        .maybeSingle();
      if (sub) {
        staff = { id: user.id, role: 'owner', _isOwnerFallback: true };
      }
    }

    if (!staff) {
      return res.status(403).json({ success: false, error: 'You are not authorized to create promotions for this venue' });
    }

    if (!['owner', 'manager'].includes(staff.role)) {
      return res.status(403).json({ success: false, error: 'Owner or Manager role required to create promotions' });
    }

    const {
      name,
      description,
      promotion_type,
      prize_type = 'cash',
      prize_value,
      prize_description,
      start_date,
      end_date,
      days_of_week,
      start_time,
      end_time,
      is_recurring = false,
      min_stakes,
      min_hours_played,
      min_buyin,
      game_types,
      qualifying_hands,
      status = 'draft',
      is_featured = false,
      image_url,
      terms_conditions,
      settings = {}
    } = req.body;

    if (!name || !promotion_type) {
      return res.status(400).json({ success: false, error: 'Name and promotion type are required' });
    }

    const { data: promotion, error } = await getSupabase()
      .from('commander_promotions')
      .insert({
        venue_id: venue_id,
        name,
        description,
        promotion_type,
        prize_type,
        prize_value,
        prize_description,
        start_date,
        end_date,
        days_of_week,
        start_time,
        end_time,
        is_recurring,
        min_stakes,
        min_hours_played,
        min_buyin,
        game_types,
        qualifying_hands,
        status,
        is_featured,
        image_url,
        terms_conditions,
        settings,
        created_by: staff._isOwnerFallback ? null : staff.id
      })
      .select(`
        *,
        poker_venues:venue_id (id, name)
      `)
      .maybeSingle();

    if (error) throw error;

    // Push notification: broadcast to realtime channel so display pages auto-update
    try {
      const channel = getSupabase().channel('promotions-push');
      await channel.send({
        type: 'broadcast',
        event: 'new_promotion',
        payload: { id: promotion.id, name: promotion.name, venue_id, promotion_type }
      });
      getSupabase().removeChannel(channel);
    } catch (broadcastErr) {
      console.warn('Broadcast notification failed (non-critical):', broadcastErr.message);
    }

    return res.status(201).json({ promotion });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Create promotion error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
