/**
 * Promotion Awards API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/promotions/[id]/awards - List awards for promotion
 * POST /api/commander/promotions/[id]/awards - Create award
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';

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
    // without verifying anything - the award list carries player names and
    // prize values.
    const _g = await guardStaff(req, res); if (!_g) return;

    const { id: promotionId } = req.query;

    if (!promotionId) {
      return res.status(400).json({ error: 'Promotion ID required' });
    }

    if (req.method === 'GET') {
      return listAwards(req, res, promotionId, _g);
    }

    if (req.method === 'POST') {
      return createAward(req, res, promotionId);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listAwards(req, res, promotionId, staff) {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    // 2026-08-20 audit fix: venue ownership on the promotion being read.
    if (staff && staff !== true && staff.venue_id !== undefined && staff.venue_id !== null) {
      const { data: promo } = await getSupabase()
        .from('commander_promotions')
        .select('id, venue_id')
        .eq('id', promotionId)
        .maybeSingle();
      if (!promo) return res.status(404).json({ error: 'Promotion Not Found' });
      if (String(promo.venue_id) !== String(staff.venue_id)) {
        return res.status(403).json({ error: 'You Are Not Staff At This Venue' });
      }
    }

    let query = getSupabase()
      .from('commander_promotion_awards')
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url),
        commander_promotions:promotion_id (id, name, promotion_type),
        commander_staff:approved_by (id, display_name)
      `, { count: 'exact' })
      .eq('promotion_id', promotionId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) {
      query = query.eq('status', status)
          .limit(100);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({
      awards: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.warn('List awards error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createAward(req, res, promotionId) {
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

    // Get promotion
    const { data: promotion } = await getSupabase()
      .from('commander_promotions')
      .select('id, venue_id, name, promotion_type, prize_type, prize_value')
      .eq('id', promotionId)
      .maybeSingle();

    if (!promotion) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    // Check if user is staff at this venue
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', promotion.venue_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!staff) {
      return res.status(403).json({ error: 'You are not authorized to create awards' });
    }

    const {
      player_id,
      player_name,
      prize_value = promotion.prize_value,
      prize_description,
      session_id,
      table_id,
      game_details,
      notes,
      auto_approve = false
    } = req.body;

    if (!player_name && !player_id) {
      return res.status(400).json({ error: 'Player name or ID required' });
    }

    if (!prize_value) {
      return res.status(400).json({ error: 'Prize value required' });
    }

    const status = auto_approve ? 'approved' : 'pending';

    const { data: award, error } = await getSupabase()
      .from('commander_promotion_awards')
      .insert({
        promotion_id: promotionId,
        venue_id: promotion.venue_id,
        player_id,
        player_name: player_name || null,
        award_type: promotion.promotion_type,
        prize_value,
        prize_description: prize_description || `${promotion.name} winner`,
        session_id,
        table_id,
        game_details,
        status,
        approved_by: auto_approve ? staff.id : null,
        approved_at: auto_approve ? new Date().toISOString() : null,
        notes
      })
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url)
      `)
      .maybeSingle();

    if (error) throw error;

    // Award XP to player if they have a profile
    if (player_id) {
      // XP system removed
    }

    return res.status(201).json({ award });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Create award error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
