/**
 * Add Time to Session API
 * POST /api/commander/dealer/sessions/[id]/add-time
 * 
 * Adds additional minutes to an active session's countdown.
 * Can be triggered by dealer when player purchases more time,
 * or by the front desk/kiosk.
 * 
 * Body: { minutes: 60 }
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../../src/lib/commander/auth';
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

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id } = req.query;
    const { minutes } = req.body;

    if (!minutes || minutes <= 0) {
      return res.status(400).json({ success: false, error: 'minutes must be a positive number' });
    }

    try {
      // Get current session
      const { data: session, error: fetchError } = await getSupabase()
        .from('commander_table_sessions')
        .select('*')
        .eq('id', id)
        .eq('status', 'active')
        .maybeSingle();

      if (fetchError || !session) {
        return res.status(404).json({ success: false, error: 'Active session not found' });
      }

      // TOURNAMENT GUARD: Never add time to tournament sessions
      const { data: tableRow } = await getSupabase()
        .from('commander_tables')
        .select('mode')
        .eq('venue_id', session.venue_id)
        .eq('table_number', session.table_number)
        .maybeSingle();

      if (tableRow?.mode === 'tournament') {
        return res.status(400).json({
          success: false,
          error: 'Cannot add time to tournament sessions - tournaments pay a one-time seat fee'
        });
      }

      // 2026-07-28 audit fix: this used to select time_added_minutes, add in JS
      // and write the sum back. Two concurrent add-time calls both read the old
      // value and the second write erased the first, so the player paid for two
      // blocks of time and got one on the clock.
      // commander_adjust_session_added_minutes does the read and the write in
      // one statement and returns the new total.
      const requestedMinutes = parseInt(minutes);

      const { data: newAddedMinutes, error: updateError } = await getSupabase()
        .rpc('commander_adjust_session_added_minutes', {
          p_session_id: id,
          p_delta: requestedMinutes
        });

      if (updateError) throw updateError;

      // Recalculate time remaining
      const now = new Date();
      const totalAllocatedSeconds = ((session.time_allocated_minutes || 0) + newAddedMinutes) * 60;
      const elapsedSeconds = Math.floor((now - new Date(session.started_at)) / 1000);
      const timeRemaining = Math.max(0, totalAllocatedSeconds - elapsedSeconds);

      // Deduct from member's prepaid balance if available.
      // 2026-07-28 audit fix: this read time_balance_minutes, compared it to the
      // requested minutes and wrote `memberBalance - minutes` back. Two
      // concurrent deductions both read the same balance and the second write
      // erased the first, so the member was charged once for two blocks of
      // time; the "can they afford it" check had the same stale read, so two
      // racing calls could each pass it against a balance that only covered
      // one.
      // The RPC applies time_balance_minutes = time_balance_minutes - delta in a
      // single statement and RAISES (errcode P0001) rather than writing a
      // negative balance, so the affordability test and the deduction are now
      // the same operation. A raise means the member could not cover it, which
      // is exactly the old `else` branch: fall back to cash at the table.
      let paymentMethod = 'cash_at_table';
      if (session.member_id) {
        const { error: deductError } = await getSupabase()
          .rpc('commander_adjust_member_balances', {
            p_member_id: session.member_id,
            p_comp_delta: 0,
            p_time_delta: -requestedMinutes,
            p_earned_delta: 0,
            p_redeemed_delta: 0
          });

        if (!deductError) {
          paymentMethod = 'from_balance';
        } else if (deductError.code !== 'P0001' && deductError.code !== 'P0002') {
          // Not "insufficient balance" / "no such member" - a real failure.
          throw deductError;
        }

        // Log the time purchase
        const { error: purchaseLogError } = await getSupabase()
          .from('commander_time_purchases')
          .insert({
            venue_id: session.venue_id,
            member_id: session.member_id,
            minutes_purchased: requestedMinutes,
            payment_method: paymentMethod,
            purchased_by: 'dealer'
          });
        if (purchaseLogError) {
          console.error('[dealer/add-time] FAILED to record time purchase - time was added but no ledger row was written:', {
            session_id: id,
            member_id: session.member_id,
            minutes_purchased: requestedMinutes,
            error: purchaseLogError.message || purchaseLogError
          });
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          session_id: id,
          minutes_added: requestedMinutes,
          total_added_minutes: newAddedMinutes,
          time_remaining_seconds: timeRemaining
        }
      });
    } catch (err) {
      console.warn('Add time error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
