/**
 * Comp Redemption API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * POST /api/commander/comps/redeem - Redeem player comps
 * GET /api/commander/comps/redeem - List redemptions
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
// 2026-07-25 audit fix: import verifyStaffSession + getUser so redemptions can be
// authorized by a verified staff session OR a Bearer player redeeming their own balance.
import { verifyStaffSession, getUser } from '../../../src/lib/commander/auth';
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
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // 2026-07-25 audit fix: auth is handled per-method below - POST accepts either
    // a verified staff session or a Bearer player redeeming their own balance, so
    // the blanket guardWriteStaff (staff-only) gate was removed.

    if (req.method === 'POST') {
      return redeemComps(req, res);
    }

    if (req.method === 'GET') {
      return listRedemptions(req, res);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function redeemComps(req, res) {
  try {
    const {
      venue_id,
      player_id,
      amount,
      redemption_type,
      description
    } = req.body;

    if (!venue_id || !player_id || !amount || !redemption_type) {
      return res.status(400).json({
        error: 'Venue ID, player ID, amount, and redemption type are required'
      });
    }

    // 2026-07-25 audit fix: authorize via EITHER a verified (HMAC-signed) staff
    // session at this venue, OR an authenticated Bearer player redeeming their
    // OWN balance (p_staff_id null for self-service redemptions).
    let staffId = null;
    const sessionResult = await verifyStaffSession(req);
    if (sessionResult.staff) {
      if (String(sessionResult.staff.venue_id) !== String(venue_id)) {
        return res.status(403).json({ error: 'Not authorized for this venue' });
      }
      staffId = sessionResult.staff.id;
    } else {
      const user = await getUser(req, res);
      if (!user) {
        return res.status(401).json({ error: 'Authorization required' });
      }
      if (String(user.id) !== String(player_id)) {
        return res.status(403).json({ error: 'Staff access required to redeem comps for another player' });
      }
    }

    // Use the database function to redeem
    const { data, error } = await getSupabase().rpc('redeem_comps', {
      p_venue_id: venue_id,
      p_player_id: player_id,
      p_amount: parseFloat(amount),
      p_redemption_type: redemption_type,
      p_description: description || `${redemption_type} redemption`,
      p_staff_id: staffId
    });

    if (error) {
      // Handle specific error messages from the function
      if (error.message.includes('Insufficient')) {
        return res.status(400).json({ error: error.message });
      }
      if (error.message.includes('frozen')) {
        return res.status(403).json({ error: 'Player comp balance is frozen' });
      }
      throw error;
    }

    // Get the redemption details
    const { data: redemption } = await getSupabase()
      .from('commander_comp_redemptions')
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url),
        commander_staff:processed_by (id, display_name)
      `)
      .eq('id', data)
      .maybeSingle();

    // Get updated balance
    const { data: balance } = await getSupabase()
      .from('commander_comp_balances')
      .select('*')
      .eq('venue_id', venue_id)
      .eq('player_id', player_id)
      .maybeSingle();

    return res.status(200).json({
      redemption,
      balance,
      // 2026-07-25 audit fix: amount may arrive as a string; coerce before toFixed.
      message: `$${parseFloat(amount).toFixed(2)} comps redeemed successfully`
    });
  } catch (error) {
    console.warn('Redeem comps error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listRedemptions(req, res) {
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

    const {
      venue_id,
      player_id,
      status,
      redemption_type,
      limit = 50,
      offset = 0
    } = req.query;

    let query = getSupabase()
      .from('commander_comp_redemptions')
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url),
        commander_staff:processed_by (id, display_name)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (venue_id) {
      // Check if staff
      const { data: staff } = await getSupabase()
        .from('commander_staff')
        .select('id, role')
        .eq('venue_id', venue_id)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (staff) {
        query = query.eq('venue_id', venue_id);
        if (player_id) {
          query = query.eq('player_id', player_id);
        }
      } else {
        query = query.eq('venue_id', venue_id).eq('player_id', user.id);
      }
    } else {
      query = query.eq('player_id', user.id);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (redemption_type) {
      query = query.eq('redemption_type', redemption_type);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    return res.status(200).json({
      redemptions: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('List redemptions error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
