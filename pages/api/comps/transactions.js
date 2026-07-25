/**
 * Comp Transactions API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/comps/transactions - List transactions
 * POST /api/commander/comps/transactions - Issue manual comp or adjustment
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
// 2026-07-25 audit fix: import verifyStaffSession for the preferred x-staff-session path.
import { guardWriteStaff, verifyStaffSession } from '../../../src/lib/commander/auth';
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
      return listTransactions(req, res);
    }

    if (req.method === 'POST') {
      return createTransaction(req, res);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listTransactions(req, res) {
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

    const {
      venue_id,
      player_id,
      transaction_type,
      limit = 50,
      offset = 0
    } = req.query;

    let query = getSupabase()
      .from('commander_comp_transactions')
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url),
        commander_staff:approved_by (id, display_name),
        commander_comp_rates:rate_id (id, name, rate_type)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    // Check if staff for venue access
    if (venue_id) {
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
        // Non-staff can only see their own
        query = query.eq('venue_id', venue_id).eq('player_id', user.id);
      }
    } else {
      // No venue specified, show user's transactions
      query = query.eq('player_id', user.id);
    }

    if (transaction_type) {
      query = query.eq('transaction_type', transaction_type);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    // Transform transactions for frontend
    const formattedTransactions = data?.map(t => ({
      ...t,
      type: t.transaction_type === 'earn' || t.transaction_type === 'bonus' ? 'earn' : 'redeem',
      amount: parseFloat(t.amount || 0)
    })) || [];

    return res.status(200).json({
      success: true,
      data: {
        transactions: formattedTransactions,
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.warn('List transactions error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
}

async function createTransaction(req, res) {
  try {
    const { venue_id, player_id, amount, description, transaction_type = 'bonus' } = req.body;

    if (!venue_id || !player_id || amount === undefined) {
      return res.status(400).json({ success: false, error: 'Venue ID, player ID, and amount are required' });
    }

    // 2026-07-25 audit fix: prefer the verified (HMAC-signed) x-staff-session;
    // fall back to Bearer JWT with an .or() lookup matching user_id OR
    // linked_user_id (the old user_id-only lookup locked out linked staff).
    let staff = null;
    const sessionResult = await verifyStaffSession(req);
    if (sessionResult.staff) {
      if (String(sessionResult.staff.venue_id) !== String(venue_id)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this venue' });
      }
      staff = sessionResult.staff;
    } else {
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

      const { data: staffRow } = await getSupabase()
        .from('commander_staff')
        .select('id, role')
        .eq('venue_id', venue_id)
        .or(`user_id.eq.${user.id},linked_user_id.eq.${user.id}`)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      staff = staffRow;
    }

    if (!staff) {
      return res.status(403).json({ success: false, error: 'Staff access required to issue comps' });
    }

    // For adjustments (negative), require dualrate or higher
    if (amount < 0 && !['owner', 'manager', 'dualrate'].includes(staff.role)) {
      return res.status(403).json({ success: false, error: 'Dual Rate role or higher required for adjustments' });
    }

    // Use the database function to issue manual comp
    const { data, error } = await getSupabase().rpc('issue_manual_comp', {
      p_venue_id: venue_id,
      p_player_id: player_id,
      p_amount: parseFloat(amount),
      p_description: description || (amount >= 0 ? 'Manual comp issued' : 'Manual adjustment'),
      p_staff_id: staff.id
    });

    if (error) throw error;

    // Get the created transaction
    const { data: transaction } = await getSupabase()
      .from('commander_comp_transactions')
      .select(`
        *,
        profiles:player_id (id, display_name, avatar_url),
        commander_staff:approved_by (id, display_name)
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

    return res.status(201).json({
      transaction,
      balance,
      // 2026-07-25 audit fix: amount may arrive as a string; coerce before toFixed.
      message: parseFloat(amount) >= 0
        ? `$${parseFloat(amount).toFixed(2)} comp issued successfully`
        : `$${Math.abs(parseFloat(amount)).toFixed(2)} adjustment applied`
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Create transaction error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
