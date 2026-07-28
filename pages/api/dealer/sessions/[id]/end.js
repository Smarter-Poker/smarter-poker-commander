/**
 * End Player Session API
 * POST /api/commander/dealer/sessions/[id]/end
 * 
 * Ends an active table session. Returns unused time back to member's balance.
 * Updates seat status to empty.
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

// Auth: STAFF — requires valid staff session
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

    try {
      // Get session
      const { data: session, error: fetchError } = await getSupabase()
        .from('commander_table_sessions')
        .select('*')
        .eq('id', id)
        .eq('status', 'active')
        .maybeSingle();

      if (fetchError || !session) {
        return res.status(404).json({ success: false, error: 'Active session not found' });
      }

      const now = new Date();
      const totalAllocatedSeconds = ((session.time_allocated_minutes || 0) + (session.time_added_minutes || 0)) * 60;
      const elapsedSeconds = Math.floor((now - new Date(session.started_at)) / 1000);
      const unusedSeconds = Math.max(0, totalAllocatedSeconds - elapsedSeconds);
      const unusedMinutes = Math.floor(unusedSeconds / 60);

      // End the session.
      // 2026-07-28 audit fix: this wrote status='ended' unconditionally, so two
      // concurrent end requests both saw an active session, both ended it and
      // BOTH ran the refund and auto-comp below — the member got the unused
      // minutes back twice and was comped twice for one session. Atomic
      // arithmetic alone does not fix that; the payout has to belong to
      // whichever caller actually performs the active -> ended transition.
      // commander_end_table_session claims that transition
      // (UPDATE ... WHERE status <> 'ended' RETURNING *) and returns NULL to
      // everyone else, so the loser falls through to the same 404 a sequential
      // second call has always received, and pays nothing out.
      const { data: endedSession, error: endError } = await getSupabase()
        .rpc('commander_end_table_session', { p_session_id: id, p_ended_by: null });

      if (endError) throw endError;
      if (!endedSession || !endedSession.id) {
        return res.status(404).json({ success: false, error: 'Active session not found' });
      }

      // Return unused time to member's balance.
      // 2026-07-28 audit fix: was select time_balance_minutes -> add in JS ->
      // write the sum back, so a concurrent write between the read and the write
      // was erased. commander_adjust_member_balances applies
      // time_balance_minutes = time_balance_minutes + delta in one statement.
      if (session.member_id && unusedMinutes > 0) {
        const { error: refundError } = await getSupabase()
          .rpc('commander_adjust_member_balances', {
            p_member_id: session.member_id,
            p_comp_delta: 0,
            p_time_delta: unusedMinutes,
            p_earned_delta: 0,
            p_redeemed_delta: 0
          });
        if (refundError) {
          console.error('[dealer/sessions/end] FAILED to refund unused minutes:', {
            session_id: id,
            member_id: session.member_id,
            unused_minutes: unusedMinutes,
            error: refundError.message || refundError
          });
        }
      }

      // Auto-comp: award hourly comps based on elapsed play time
      let compEarned = 0;
      if (session.member_id && session.venue_id) {
        try {
          const { data: venueSettings } = await getSupabase()
            .from('commander_venue_settings')
            .select('auto_comp_rate')
            .eq('venue_id', session.venue_id)
            .maybeSingle();

          const rate = parseFloat(venueSettings?.auto_comp_rate || 0);
          if (rate > 0) {
            const elapsedMinutes = Math.floor(elapsedSeconds / 60);
            compEarned = Math.round((elapsedMinutes / 60) * rate * 100) / 100;

            if (compEarned > 0) {
              // Update member comp balance.
              // 2026-07-28 audit fix: was select comp_balance/comp_lifetime_earned
              // -> add in JS -> write the sums back, losing any concurrent write.
              // commander_txn_award_comp writes the comp_log row and applies
              // comp_balance = comp_balance + delta in one transaction, and
              // stamps balance_after from the balance the increment actually
              // produced rather than from the stale read.
              //
              // The idempotency key is derived from the session id, so the
              // auto-comp for a given session can only ever be granted once,
              // however many times this route runs for it.
              const { data: compResult, error: compRpcErr } = await getSupabase()
                .rpc('commander_txn_award_comp', {
                  p_member_id: session.member_id,
                  p_venue_id: session.venue_id,
                  p_log_amount: compEarned,
                  p_comp_delta: compEarned,
                  p_time_delta: 0,
                  p_earned_delta: compEarned,
                  p_redeemed_delta: 0,
                  p_type: 'auto_hourly',
                  p_reason: `Auto comp: ${elapsedMinutes} min × $${rate}/hr`,
                  p_comp_category: 'auto_hourly',
                  p_idempotency_key: `auto_hourly:${id}`
                });

              if (compRpcErr) {
                console.warn('Auto-comp award error (non-fatal):', compRpcErr.message || compRpcErr);
                compEarned = 0;
              } else if (compResult?.replayed === true) {
                // Already comped for this session; do not report it twice.
                compEarned = 0;
              }
            }
          }
        } catch (compErr) {
          console.warn('Auto-comp award error (non-fatal):', compErr);
        }
      }

      // Clear the seat
      await getSupabase()
        .from('commander_table_seats')
        .update({
          status: 'empty',
          player_name: null,
          member_id: null,
          seated_at: null
        })
        .eq('venue_id', session.venue_id)
        .eq('table_number', session.table_number)
        .eq('seat_number', session.seat_number);

      return res.status(200).json({
        success: true,
        data: {
          session_id: id,
          elapsed_minutes: Math.floor(elapsedSeconds / 60),
          unused_minutes_returned: unusedMinutes,
          comp_earned: compEarned
        }
      });
    } catch (err) {
      console.warn('End session error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
