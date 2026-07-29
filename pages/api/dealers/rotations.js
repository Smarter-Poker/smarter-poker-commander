/**
 * Dealer Rotations API
 * POST /api/commander/dealers/rotations - Create/manage dealer rotation
 * GET /api/commander/dealers/rotations - Get current rotations
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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method === 'GET') {
      return getRotations(req, res);
    }

    if (req.method === 'POST') {
      return createRotation(req, res);
    }

    res.setHeader('Allow', ['GET', 'POST']);
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

async function getRotations(req, res) {
  const { venue_id } = req.query;

  if (!venue_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'venue_id is required' }
    });
  }

  // Light auth for GET (read-only) — matches tables API pattern
  const staffSession = req.headers['x-staff-session'];
  if (!staffSession) {
    return res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Staff authentication required' }
    });
  }
  let sessionData;
  try {
    sessionData = JSON.parse(staffSession);
    if (String(sessionData.venue_id) !== String(venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Venue mismatch' }
      });
    }
  } catch {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_SESSION', message: 'Invalid session format' }
    });
  }

  try {
    // Get active dealer assignments — only dealer_id FK exists in rotations table
    // table_number and dealer_name are stored directly as columns
    let rotations = [];
    try {
      const result = await getSupabase()
        .from('commander_dealer_rotations')
        .select(`
          id,
          started_at,
          ended_at,
          dealer_name,
          table_number,
          dealer_id,
          commander_dealers:dealer_id (id, name, employee_id)
        `)
        .eq('venue_id', venue_id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })

      if (result.error) throw result.error;
      rotations = result.data || [];
    } catch (joinErr) {
      console.warn('[Rotations] FK join failed, falling back:', joinErr?.message || joinErr);
      // Fallback: query without FK join
      const result = await getSupabase()
        .from('commander_dealer_rotations')
        .select('id, started_at, ended_at, dealer_name, table_number, dealer_id')
        .eq('venue_id', venue_id)
        .is('ended_at', null)
        .order('started_at', { ascending: false });

      if (result.error) throw result.error;
      rotations = result.data || [];
    }

    return res.status(200).json({
      success: true,
      data: { rotations: rotations || [] }
    });
  } catch (error) {
    console.warn('Get rotations error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to get rotations' }
    });
  }
}

async function createRotation(req, res) {
  const { venue_id, dealer_id, table_id, game_id, action } = req.body;

  if (!venue_id || !dealer_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'venue_id and dealer_id are required' }
    });
  }

  // Require floor staff or higher to manage rotations
  const staff = await requireStaff(req, res, venue_id, ['owner', 'manager', 'floor']);
  if (!staff) return;

  try {
    // Verify dealer belongs to venue
    const { data: dealer, error: dealerError } = await getSupabase()
      .from('commander_dealers')
      .select('id, name')
      .eq('id', dealer_id)
      .eq('venue_id', venue_id)
      .eq('is_active', true)
      .maybeSingle();

    // Look up table_number from table_id for complete rotation records
    let resolvedTableNumber = null;
    if (table_id) {
      const { data: tbl } = await getSupabase()
        .from('commander_tables')
        .select('table_number')
        .eq('id', table_id)
        .maybeSingle();
      resolvedTableNumber = tbl?.table_number || null;
    }

    if (dealerError || !dealer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Dealer not found' }
      });
    }

    // Handle different actions
    if (action === 'push') {
      // End current assignment
      await getSupabase()
        .from('commander_dealer_rotations')
        .update({ ended_at: new Date().toISOString() })
        .eq('dealer_id', dealer_id)
        .is('ended_at', null);

      // Create new assignment if table provided
      if (table_id) {
        const { data: assignment, error } = await getSupabase()
          .from('commander_dealer_rotations')
          .insert({
            venue_id: venue_id,
            dealer_id,
            dealer_name: dealer.name,
            table_id: table_id,
            table_number: resolvedTableNumber,
            started_at: new Date().toISOString()
          })
          .select()
          .maybeSingle();

        if (error) throw error;

        return res.status(201).json({
          success: true,
          data: { assignment, message: `${dealer.name} pushed to table ${table_id}` }
        });
      }

      return res.status(200).json({
        success: true,
        data: { message: `${dealer.name} pushed off table` }
      });
    }

    if (action === 'break') {
      // End current assignment and mark dealer on break
      await getSupabase()
        .from('commander_dealer_rotations')
        .update({ ended_at: new Date().toISOString() })
        .eq('dealer_id', dealer_id)
        .is('ended_at', null);

      await getSupabase()
        .from('commander_dealers')
        .update({
          current_status: 'on_break',
          break_started_at: new Date().toISOString()
        })
        .eq('id', dealer_id);

      return res.status(200).json({
        success: true,
        data: { message: `${dealer.name} is now on break` }
      });
    }

    if (action === 'return') {
      // Return from break
      await getSupabase()
        .from('commander_dealers')
        .update({
          current_status: 'available',
          break_started_at: null
        })
        .eq('id', dealer_id);

      return res.status(200).json({
        success: true,
        data: { message: `${dealer.name} returned from break` }
      });
    }

    // Default: assign to table
    if (!table_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'table_id is required for assignment' }
      });
    }

    // End any current assignment for this dealer
    await getSupabase()
      .from('commander_dealer_rotations')
      .update({ ended_at: new Date().toISOString() })
      .eq('dealer_id', dealer_id)
      .is('ended_at', null);

    // End any current assignment for this table
    await getSupabase()
      .from('commander_dealer_rotations')
      .update({ ended_at: new Date().toISOString() })
      .eq('table_id', table_id)
      .is('ended_at', null);

    // Create new assignment
    const { data: assignment, error } = await getSupabase()
      .from('commander_dealer_rotations')
      .insert({
        venue_id: venue_id,
        dealer_id,
        dealer_name: dealer.name,
        table_id: table_id,
        table_number: resolvedTableNumber,
        started_at: new Date().toISOString()
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      data: { assignment, message: `${dealer.name} assigned to table` }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Create rotation error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create rotation' }
    });
  }
}
