/**
 * Commander Membership Plans API
 * GET    - List plans for venue
 * POST   - Create new plan
 * PUT    - Update plan (requires ?id=)
 * DELETE - Deactivate plan (requires ?id=)
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

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

  // Auth guard: require staff auth for write operations
  const _authResult = await guardWriteStaff(req, res);
  if (!_authResult) return;

  const { venue_id, id, include_inactive } = req.query;
  if (!venue_id) return res.status(400).json({ success: false, error: 'venue_id required' });

  // GET - List plans (auto-seeds defaults if none exist)
  if (req.method === 'GET') {
    let query = getSupabase()
      .from('commander_membership_plans')
      .select('*')
      .eq('venue_id', venue_id)
      .order('sort_order', { ascending: true })
          .limit(100);

    if (!include_inactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, error: 'Internal server error' });

    // Auto-seed default interval plans for new venues
    if (!data || data.length === 0) {
      const DEFAULT_PLANS = [
        {
          tier: 'daily', name: 'Daily Membership', description: 'One-Day Access Pass',
          color: '#22D3EE', sort_order: 0,
          price_daily: 5, price_weekly: null, price_monthly: null, price_yearly: null,
          comp_multiplier: 1.0, seat_fee_discount_pct: 0, tournament_discount_pct: 0,
          priority_waitlist: false, reserved_seating: false,
          free_food_drinks: false, free_parking: false,
          guest_passes_per_month: 0, custom_perks: [], max_members: null, is_active: true,
        },
        {
          tier: 'weekly', name: 'Weekly Membership', description: 'Seven-Day Access Pass',
          color: '#31A24C', sort_order: 1,
          price_daily: null, price_weekly: 10, price_monthly: null, price_yearly: null,
          comp_multiplier: 1.0, seat_fee_discount_pct: 0, tournament_discount_pct: 0,
          priority_waitlist: false, reserved_seating: false,
          free_food_drinks: false, free_parking: false,
          guest_passes_per_month: 0, custom_perks: [], max_members: null, is_active: true,
        },
        {
          tier: 'monthly', name: 'Monthly Membership', description: '30-Day Access Pass',
          color: '#F59E0B', sort_order: 2,
          price_daily: null, price_weekly: null, price_monthly: 25, price_yearly: null,
          comp_multiplier: 1.0, seat_fee_discount_pct: 0, tournament_discount_pct: 0,
          priority_waitlist: false, reserved_seating: false,
          free_food_drinks: false, free_parking: false,
          guest_passes_per_month: 0, custom_perks: [], max_members: null, is_active: true,
        },
        {
          tier: 'yearly', name: 'Yearly Membership', description: 'Full-Year Access Pass',
          color: '#8B5CF6', sort_order: 3,
          price_daily: null, price_weekly: null, price_monthly: null, price_yearly: 199,
          comp_multiplier: 1.0, seat_fee_discount_pct: 0, tournament_discount_pct: 0,
          priority_waitlist: false, reserved_seating: false,
          free_food_drinks: false, free_parking: false,
          guest_passes_per_month: 0, custom_perks: [], max_members: null, is_active: true,
        },
      ].map(p => ({ ...p, venue_id: parseInt(venue_id) }));

      const { data: seeded, error: seedErr } = await getSupabase()
        .from('commander_membership_plans')
        .insert(DEFAULT_PLANS)
        .select()
        .order('sort_order', { ascending: true });

      if (seedErr) {
        console.warn('[Membership] Auto-seed error:', seedErr);
        return res.json({ success: true, data: { plans: [] } });
      }
      return res.json({ success: true, data: { plans: seeded || [] } });
    }

    return res.json({ success: true, data: { plans: data || [] } });
  }

  // POST - Create plan
  if (req.method === 'POST') {
    const {
      tier, name, description, color, sort_order,
      price_daily, price_weekly, price_monthly, price_yearly,
      seat_fee_override, seat_fee_discount_pct,
      comp_multiplier, priority_waitlist, free_food_drinks, free_parking,
      guest_passes_per_month, reserved_seating, tournament_discount_pct,
      custom_perks, max_members
    } = req.body;

    if (!tier || !name) {
      return res.status(400).json({ success: false, error: 'tier and name are required' });
    }

    const { data, error } = await getSupabase()
      .from('commander_membership_plans')
      .insert({
        venue_id: parseInt(venue_id),
        tier, name, description, color: color || '#1877F2',
        sort_order: sort_order || 0,
        price_daily: price_daily || null,
        price_weekly: price_weekly || null,
        price_monthly: price_monthly || null,
        price_yearly: price_yearly || null,
        seat_fee_override: seat_fee_override || null,
        seat_fee_discount_pct: seat_fee_discount_pct || 0,
        comp_multiplier: comp_multiplier || 1.0,
        priority_waitlist: priority_waitlist || false,
        free_food_drinks: free_food_drinks || false,
        free_parking: free_parking || false,
        guest_passes_per_month: guest_passes_per_month || 0,
        reserved_seating: reserved_seating || false,
        tournament_discount_pct: tournament_discount_pct || 0,
        custom_perks: custom_perks || [],
        max_members: max_members || null,
        is_active: true
      })
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
    return res.json({ success: true, data: { plan: data } });
  }

  // PUT - Update plan
  if (req.method === 'PUT') {
    if (!id) return res.status(400).json({ success: false, error: 'id required' });

    const updates = { ...req.body, updated_at: new Date().toISOString() };
    delete updates.id;
    delete updates.venue_id;
    delete updates.created_at;

    const { data, error } = await getSupabase()
      .from('commander_membership_plans')
      .update(updates)
      .eq('id', id)
      .eq('venue_id', venue_id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
    return res.json({ success: true, data: { plan: data } });
  }

  // DELETE - Soft deactivate
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ success: false, error: 'id required' });

    const { data, error } = await getSupabase()
      .from('commander_membership_plans')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('venue_id', venue_id)
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
    return res.json({ success: true, data: { plan: data } });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[pages/api/commander/membership-plans.js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
