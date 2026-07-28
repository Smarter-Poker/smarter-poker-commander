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

      // 2026-07-28 audit fix: the purchased minutes used to be added to the
      // member's time_balance_minutes AND to the active session's
      // time_added_minutes, with neither deducted. A seated player who bought 60
      // minutes got 60 minutes of table time AND kept 60 minutes of credit, so
      // the room gave the time away on every kiosk purchase made by a seated
      // player. The prepaid model is a strict transfer, exactly as
      // pages/api/dealer/sessions/[id]/add-time.js implements it: put the minutes
      // on the session clock, then deduct the same minutes from the balance.
      // Net effect for a seated buyer is balance unchanged, clock +minutes.
      if (isSeated) {
        const { error: sessionError } = await getSupabase()
          .from('commander_table_sessions')
          .update({
            time_added_minutes: (activeSession[0].time_added_minutes || 0) + purchasedMinutes,
            updated_at: new Date().toISOString()
          })
          .eq('id', activeSession[0].id);

        if (sessionError) throw sessionError;
      }

      const newBalance = isSeated ? currentBalance : currentBalance + purchasedMinutes;

      // Update member balance
      const { error: updateError } = await getSupabase()
        .from('commander_members')
        .update({
          time_balance_minutes: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', member_id);

      if (updateError) throw updateError;

      // Log the purchase. 2026-07-28 audit fix: this insert's result was
      // discarded, so while commander_time_purchases.venue_id was typed uuid and
      // rejected the integer venue ids callers pass, every kiosk sale was lost
      // silently — cash collected, no record. The column is bigint now; keep the
      // error and log it loudly so any future schema drift fails visibly.
      const { error: purchaseLogError } = await getSupabase()
        .from('commander_time_purchases')
        .insert({
          venue_id: member.venue_id,
          member_id: member.id,
          minutes_purchased: purchasedMinutes,
          amount_paid: amount ? parseFloat(amount) : null,
          payment_method: payment_method || 'kiosk',
          purchased_by: 'kiosk_self_service'
        });

      if (purchaseLogError) {
        console.error('[kiosk/buy-time] FAILED to record time purchase — cash was collected but no ledger row was written:', {
          member_id: member.id,
          venue_id: member.venue_id,
          minutes_purchased: purchasedMinutes,
          error: purchaseLogError.message || purchaseLogError
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          member_id,
          minutes_added: purchasedMinutes,
          previous_balance: currentBalance,
          new_balance: newBalance,
          added_to_active_session: isSeated,
          purchase_logged: !purchaseLogError
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
