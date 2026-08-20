/**
 * Single Award API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * PUT /api/commander/promotions/[id]/awards/[awardId] - Update award (approve/pay/void)
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/sentryWrap';

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

    const { id: promotionId, awardId } = req.query;

    if (!promotionId || !awardId) {
      return res.status(400).json({ error: 'Promotion ID and Award ID required' });
    }

    if (req.method === 'PUT') {
      return updateAward(req, res, promotionId, awardId);
    }

    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function updateAward(req, res, promotionId, awardId) {
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

    // Get award
    const { data: award } = await getSupabase()
      .from('commander_promotion_awards')
      .select('id, venue_id, status')
      .eq('id', awardId)
      .eq('promotion_id', promotionId)
      .maybeSingle();

    if (!award) {
      return res.status(404).json({ error: 'Award not found' });
    }

    // Check if user is staff at this venue
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', award.venue_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!staff) {
      return res.status(403).json({ error: 'You are not authorized to update awards' });
    }

    const { action, notes } = req.body;

    if (!action || !['approve', 'pay', 'void'].includes(action)) {
      return res.status(400).json({ error: 'Valid action required: approve, pay, or void' });
    }

    const updates = { metadata: { updated_by: user.id } };

    if (action === 'approve') {
      if (award.status !== 'pending') {
        return res.status(400).json({ error: 'Can only approve pending awards' });
      }
      updates.status = 'approved';
      updates.approved_by = staff.id;
      updates.approved_at = new Date().toISOString();
    } else if (action === 'pay') {
      if (award.status !== 'approved') {
        return res.status(400).json({ error: 'Can only pay approved awards' });
      }
      updates.status = 'paid';
      updates.paid_at = new Date().toISOString();
    } else if (action === 'void') {
      updates.status = 'void';
    }

    if (notes) {
      updates.notes = notes;
    }

    const { data: updatedAward, error } = await getSupabase()
      .from('commander_promotion_awards')
      .update(updates)
      .eq('id', awardId)
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url),
        commander_staff:approved_by (id, display_name)
      `)
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({
      award: updatedAward,
      message: `Award ${action}${action === 'pay' ? 'id' : action === 'void' ? 'ed' : 'd'}`
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Update award error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
