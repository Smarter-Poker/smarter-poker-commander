/**
 * Kiosk Buy Time API
 * POST /api/commander/kiosk/buy-time
 * 
 * Adds purchased time to a member's time_balance_minutes.
 * Logs the purchase in commander_time_purchases.
 * 
 * Body: { member_id, minutes, amount, payment_method }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { checkMemoryRateLimit } from '../../../src/lib/commander/rateLimit';
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

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    // Staff auth: kiosk devices must present an HMAC-signed staff session.
    // 2026-07-28 audit fix: this route used to JSON.parse the raw x-staff-session
    // header and look the staff row up by sessionData.id with no signature check,
    // no TTL and no venue scoping — anyone who learned a staff UUID could grant
    // any member any number of prepaid minutes at any venue. guardStaff routes
    // through verifyStaffSession, which checks the HMAC and enforces the session
    // TTL, and it emits the 401 itself (same shape as the other money routes,
    // e.g. pages/api/dealer/sessions/[id]/add-time.js).
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    // Rate limit: 10 purchases per minute per IP (kiosk device)
    const fwd = req.headers['x-forwarded-for'];
    const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
    const rl = checkMemoryRateLimit(`kiosk:${ip}`, 10, 60000);
    if (!rl.allowed) { return res.status(429).json({ success: false, error: 'Too many requests' }); }

    const { member_id, minutes, amount, payment_method } = req.body;

    if (!member_id || !minutes || minutes <= 0) {
      return res.status(400).json({ success: false, error: 'member_id and minutes are required' });
    }

    try {
      // Get current member
      const { data: member, error: fetchError } = await getSupabase()
        .from('commander_members')
        .select('id, venue_id, time_balance_minutes, first_name, last_name')
        .eq('id', member_id)
        .maybeSingle();

      if (fetchError || !member) {
        return res.status(404).json({ success: false, error: 'Member not found' });
      }

      // Venue scoping: a kiosk may only sell time to members of its own venue.
      if (_staff.venue_id && String(member.venue_id) !== String(_staff.venue_id)) {
        return res.status(403).json({ success: false, error: 'Cannot buy time for a member at another venue' });
      }

      const purchasedMinutes = parseInt(minutes);
      const currentBalance = member.time_balance_minutes || 0;

      // Is the buyer currently seated? Decide before writing anything, because a
      // seated purchase is a transfer onto the table clock, not a standing credit.
      const { data: activeSession } = await getSupabase()
        .from('commander_table_sessions')
        .select('id, time_added_minutes')
        .eq('member_id', member_id)
        .eq('status', 'active')
        .limit(1);

      const isSeated = activeSession?.length > 0;

      // 2026-07-28 audit fix (1): the purchased minutes used to be added to the
      // member's time_balance_minutes AND to the active session's
      // time_added_minutes, with neither deducted. A seated player who bought 60
      // minutes got 60 minutes of table time AND kept 60 minutes of credit, so
      // the room gave the time away on every kiosk purchase made by a seated
      // player. The prepaid model is a strict transfer, exactly as
      // pages/api/dealer/sessions/[id]/add-time.js implements it: put the minutes
      // on the session clock, then leave the balance alone.
      //
      // 2026-07-28 audit fix (2): both writes were read-modify-write — select the
      // value, add in JS, write the sum back — so two concurrent kiosk purchases
      // both read the old value and the second write erased the first. Cash was
      // taken twice and one lot of minutes was credited. The purchase-log insert
      // was also a separate statement, so a crash between the two left cash
      // collected with no ledger row.
      //
      // commander_txn_member_time_purchase does all of it in one transaction:
      // the ledger row first, then the atomic
      // `col = col + delta` against either the session clock or the member
      // balance. idempotency_key is optional; on a resubmission the ORIGINAL
      // purchase row is returned with success and no minutes are granted twice.
      const idempotencyKey = typeof req.body?.idempotency_key === 'string' && req.body.idempotency_key.trim()
        ? req.body.idempotency_key.trim().slice(0, 200)
        : null;

      const { data: result, error: purchaseError } = await getSupabase()
        .rpc('commander_txn_member_time_purchase', {
          p_member_id: member_id,
          p_minutes: purchasedMinutes,
          p_session_id: isSeated ? activeSession[0].id : null,
          p_venue_id: member.venue_id,
          p_amount_paid: amount ? parseFloat(amount) : null,
          p_payment_method: payment_method || 'kiosk',
          p_purchased_by: 'kiosk_self_service',
          p_idempotency_key: idempotencyKey
        });

      if (purchaseError) {
        // Cash may already have been collected at the kiosk, so make this loud.
        console.error('[kiosk/buy-time] FAILED to apply time purchase — no minutes granted and no ledger row written:', {
          member_id,
          venue_id: member.venue_id,
          minutes_purchased: purchasedMinutes,
          error: purchaseError.message || purchaseError
        });
        if (purchaseError.code === 'P0002') {
          return res.status(404).json({ success: false, error: 'Member not found' });
        }
        throw purchaseError;
      }

      const newBalance = result?.new_balance ?? currentBalance;

      // Response shape unchanged. purchase_logged is now always true on the
      // success path: the ledger insert happens inside the same transaction as
      // the balance change, so if it had failed we would not be here.
      return res.status(200).json({
        success: true,
        data: {
          member_id,
          minutes_added: purchasedMinutes,
          previous_balance: result?.previous_balance ?? currentBalance,
          new_balance: newBalance,
          added_to_active_session: result?.added_to_active_session ?? isSeated,
          purchase_logged: true,
          replayed: result?.replayed === true
        }
      });
    } catch (err) {
      console.warn('Kiosk buy time error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
