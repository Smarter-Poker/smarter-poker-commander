/**
 * Dealer Schedule API - GET/POST /api/commander/dealers/schedule
 * View and create dealer rotation assignments
 * Reference: ENHANCEMENTS.md - Dealer Management Suite
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { requireStaff } from '../../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    // CDN cache: fresh for 60s, serve stale up to 300s
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    }

    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method === 'GET') {
      return handleList(req, res);
    } else if (req.method === 'POST') {
      return handleCreate(req, res);
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

async function handleList(req, res) {
  const { venue_id, dealer_id, date, active_only } = req.query;

  if (!venue_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'venue_id required' }
    });
  }

  // Require staff auth
  const staff = await requireStaff(req, res, venue_id);
  if (!staff) return;

  try {
    let query = getSupabase()
      .from('commander_dealer_rotations')
      .select(`
        *,
        commander_dealers (id, name, skill_level, certified_games),
        commander_tables (id, table_number, status)
      `)
      .eq('venue_id', venue_id)
      .order('started_at', { ascending: false })

    if (dealer_id) {
      query = query.eq('dealer_id', dealer_id)
    }

    if (date) {
      query = query.gte('started_at', `${date}T00:00:00`)
        .lt('started_at', `${date}T23:59:59`);
    }

    if (active_only === 'true') {
      query = query.is('ended_at', null);
    }

    const { data: rotations, error } = await query;

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: { rotations: rotations || [] }
    });
  } catch (error) {
    console.warn('List dealer schedule error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch dealer schedule' }
    });
  }
}

async function handleCreate(req, res) {
  const { venue_id, dealer_id, table_id } = req.body;

  if (!venue_id || !dealer_id || !table_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'venue_id, dealer_id, and table_id required' }
    });
  }

  // Require manager auth to assign dealers
  const staff = await requireStaff(req, res, venue_id, ['owner', 'manager', 'floor']);
  if (!staff) return;

  try {
    // Verify dealer exists and belongs to venue
    const { data: dealer, error: dealerError } = await getSupabase()
      .from('commander_dealers')
      .select('id, name')
      .eq('id', dealer_id)
      .eq('venue_id', venue_id)
      .maybeSingle();

    if (dealerError || !dealer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Dealer not found at this venue' }
      });
    }


    // Verify table exists and belongs to venue
    const { data: table, error: tableError } = await getSupabase()
      .from('commander_tables')
      .select('id, table_number')
      .eq('id', table_id)
      .eq('venue_id', venue_id)
      .maybeSingle();

    if (tableError || !table) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Table not found at this venue' }
      });
    }

    // End any current rotation for this dealer
    await getSupabase()
      .from('commander_dealer_rotations')
      .update({ ended_at: new Date().toISOString() })
      .eq('dealer_id', dealer_id)
      .eq('venue_id', venue_id)
      .is('ended_at', null);

    // End any current rotation at this table
    await getSupabase()
      .from('commander_dealer_rotations')
      .update({ ended_at: new Date().toISOString() })
      .eq('table_id', table_id)
      .eq('venue_id', venue_id)
      .is('ended_at', null);

    // Create new rotation
    const { data: rotation, error: insertError } = await getSupabase()
      .from('commander_dealer_rotations')
      .insert({
        venue_id,
        dealer_id,
        table_id,
        dealer_name: dealer.name,
        table_number: table.table_number,
        started_at: new Date().toISOString()
      })
      .select(`
        *,
        commander_dealers (id, name, skill_level),
        commander_tables (id, table_number)
      `)
      .maybeSingle();

    if (insertError) throw insertError;

    return res.status(201).json({
      success: true,
      data: { rotation }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Create dealer rotation error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create dealer rotation' }
    });
  }
}
