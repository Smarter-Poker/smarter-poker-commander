/**
 * Cash Game Transactions API
 * GET /api/commander/cashier?venue_id=X - List transactions (optional: table_number, session_id, type, date)
 * POST /api/commander/cashier - Record buy-in, cash-out, add-on, time_purchase, or membership
 * PATCH /api/commander/cashier - Mark a transaction as voided (sets voided_at, voided_by, void_reason)
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardStaff } from '../../src/lib/commander/auth';
import { logAction } from '../../src/lib/commander/audit';
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

const VALID_TYPES = ['buy_in', 'cash_out', 'add_on', 'time_purchase', 'membership', 'void'];
// Upper bound on a single cashier transaction (column is numeric(10,2)).
const MAX_TXN_AMOUNT = 1000000;

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const staff = await guardStaff(req, res); if (!staff) return;

    if (req.method === 'GET') return handleGet(req, res, staff);
    if (req.method === 'POST') return handlePost(req, res, staff);
    if (req.method === 'PATCH') return handlePatch(req, res, staff);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleGet(req, res, staff) {
  try {
    const { table_number, session_id, type, date, player_name, limit: rawLimit = '100' } = req.query;
    const venue_id = req.query.venue_id || staff.venue_id;
    if (!venue_id) return res.status(400).json({ success: false, error: 'venue_id required' });
    const limit = Math.min(parseInt(rawLimit) || 100, 500);

    let query = getSupabase()
      .from('commander_cash_transactions')
      .select('*')
      .eq('venue_id', venue_id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (table_number) query = query.eq('table_number', parseInt(table_number));
    if (session_id) query = query.eq('session_id', session_id);
    if (type) query = query.eq('type', type);
    if (player_name) query = query.eq('player_name', player_name);
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query = query.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    const transactions = data || [];
    // Exclude voided transactions AND void audit records from summary calculations
    // void-type records are audit trail only - the original transaction is already excluded via voided_at
    const active = transactions.filter(t => !t.voided_at && t.type !== 'void');
    const buyIns = active.filter(t => ['buy_in', 'add_on', 'time_purchase', 'membership'].includes(t.type));
    const cashOuts = active.filter(t => ['cash_out'].includes(t.type));

    const summary = {
      total_buy_ins: buyIns.reduce((s, t) => s + parseFloat(t.amount), 0),
      total_cash_outs: cashOuts.reduce((s, t) => s + parseFloat(t.amount), 0),
      buy_in_count: buyIns.length,
      cash_out_count: cashOuts.length,
      net_drop: buyIns.reduce((s, t) => s + parseFloat(t.amount), 0) - cashOuts.reduce((s, t) => s + parseFloat(t.amount), 0),
    };

    return res.status(200).json({ success: true, data: transactions, summary });
  } catch (err) {
    console.warn('Cashier GET error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handlePost(req, res, staff) {
  try {
    const { venue_id, session_id, player_name, table_number, seat_number, type, amount, chip_count, payment_method, notes, pin_verified_by } = req.body;

    if (!venue_id || !player_name || !type) {
      return res.status(400).json({ success: false, error: 'venue_id, player_name, and type required' });
    }

    // BUG #252 FIX: Enforce staff can only create transactions in their own venue
    if (staff.venue_id && String(venue_id) !== String(staff.venue_id)) {
      return res.status(403).json({ success: false, error: 'Cannot create transactions for another venue' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    // 2026-07-28 audit fix: `parseFloat(amount) || 0` recorded $0 for a garbled
    // amount instead of rejecting it - parseFloat('abc') is NaN which `|| 0`
    // turned into a silent zero-dollar transaction, and parseFloat('12abc')
    // silently became 12. Coerce strictly with Number() and reject anything that
    // is not a finite, in-range value. amount stays optional (it is not required
    // above); only a supplied-but-unparseable amount is rejected.
    const amountProvided = amount !== undefined && amount !== null && amount !== '';
    const parsedAmount = amountProvided
      ? ((typeof amount === 'number' || typeof amount === 'string') ? Number(amount) : NaN)
      : 0;
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0 || parsedAmount > MAX_TXN_AMOUNT) {
      return res.status(400).json({ success: false, error: `amount must be a number between 0 and ${MAX_TXN_AMOUNT}` });
    }

    const { data, error } = await getSupabase()
      .from('commander_cash_transactions')
      .insert({
        venue_id,
        session_id: session_id || null,
        player_name,
        table_number: table_number ? parseInt(table_number) : null,
        seat_number: seat_number ? parseInt(seat_number) : null,
        type,
        amount: parsedAmount,
        chip_count: chip_count ? parseFloat(chip_count) : parsedAmount,
        payment_method: payment_method || 'cash',
        processed_by: pin_verified_by || staff.id,
        notes: notes || null,
      })
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(500).json({ success: false, error: 'Failed to record transaction' });

    // Audit log
    await logAction({ action: `cashier_${type}`, category: 'cashier' }, {
      venueId: venue_id,
      staffId: pin_verified_by || staff.id,
      targetId: data.id,
      targetType: 'commander_cash_transactions',
      targetName: player_name,
      metadata: { amount: parsedAmount, method: payment_method },
      req
    });

    // Get updated player totals for this session - EXCLUDE voided transactions
    let playerTotals = null;
    if (session_id) {
      const { data: txns } = await getSupabase()
        .from('commander_cash_transactions')
        .select('type, amount, voided_at')
        .eq('session_id', session_id);

      if (txns) {
        const active = txns.filter(t => !t.voided_at && t.type !== 'void');
        const ins = active.filter(t => ['buy_in', 'add_on', 'time_purchase', 'membership'].includes(t.type)).reduce((s, t) => s + parseFloat(t.amount), 0);
        const outs = active.filter(t => ['cash_out'].includes(t.type)).reduce((s, t) => s + parseFloat(t.amount), 0);
        playerTotals = { total_bought: ins, total_cashed: outs, net: outs - ins };
      }
    }

    return res.status(201).json({ success: true, data, player_totals: playerTotals });
  } catch (err) {
    console.warn('Cashier POST error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// PATCH - Mark transaction as voided (audit trail)
async function handlePatch(req, res, staff) {
  try {
    const { transaction_id, voided_by, void_reason } = req.body;
    if (!transaction_id) {
      return res.status(400).json({ success: false, error: 'transaction_id required' });
    }

    // SAFEGUARD: Fetch the transaction first to verify it exists and isn't already voided
    const { data: existing, error: fetchErr } = await getSupabase()
      .from('commander_cash_transactions')
      .select('id, voided_at, venue_id')
      .eq('id', transaction_id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    // SAFEGUARD: Prevent double-void - already voided transactions cannot be voided again
    if (existing.voided_at) {
      return res.status(400).json({ success: false, error: 'Transaction already voided', data: existing });
    }

    // SAFEGUARD: Scope to venue - staff can only void transactions in their venue
    // BUG #254 FIX: Always use staff.venue_id, never fall back to req.body
    if (staff.venue_id && existing.venue_id && String(existing.venue_id) !== String(staff.venue_id)) {
      return res.status(403).json({ success: false, error: 'Cannot void transactions from another venue' });
    }

    const { data, error } = await getSupabase()
      .from('commander_cash_transactions')
      .update({
        voided_at: new Date().toISOString(),
        voided_by: staff.id, // BUG #253 FIX: Always use authenticated staff.id, never trust client input
        void_reason: void_reason || 'Voided by staff',
      })
      .eq('id', transaction_id)
      .select()
      .maybeSingle();

    if (error) throw error;

    // Audit log
    await logAction({ action: 'cashier_void', category: 'cashier' }, {
      venueId: existing.venue_id,
      staffId: staff.id,
      targetId: transaction_id,
      targetType: 'commander_cash_transactions',
      metadata: { reason: void_reason },
      req
    });

    return res.status(200).json({ success: true, data });
  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Cashier PATCH error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
