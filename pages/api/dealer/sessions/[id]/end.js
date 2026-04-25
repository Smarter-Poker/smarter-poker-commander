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

      // End the session
      const { error: endError } = await getSupabase()
        .from('commander_table_sessions')
        .update({
          status: 'ended',
          ended_at: now.toISOString(),
          updated_at: now.toISOString()
        })
        .eq('id', id);

      if (endError) throw endError;

      // Return unused time to member's balance
      if (session.member_id && unusedMinutes > 0) {
        const { data: member } = await getSupabase()
          .from('commander_members')
          .select('time_balance_minutes')
          .eq('id', session.member_id)
          .maybeSingle();

        if (member) {
          await getSupabase()
            .from('commander_members')
            .update({
              time_balance_minutes: (member.time_balance_minutes || 0) + unusedMinutes,
              updated_at: now.toISOString()
            })
            .eq('id', session.member_id);
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
              // Update member comp balance
              const { data: member } = await getSupabase()
                .from('commander_members')
                .select('comp_balance, comp_lifetime_earned')
                .eq('id', session.member_id)
                .maybeSingle();

              if (member) {
                await getSupabase()
                  .from('commander_members')
                  .update({
                    comp_balance: Math.round(((member.comp_balance || 0) + compEarned) * 100) / 100,
                    comp_lifetime_earned: Math.round(((member.comp_lifetime_earned || 0) + compEarned) * 100) / 100,
                    updated_at: now.toISOString()
                  })
                  .eq('id', session.member_id);

                // Log the auto-comp transaction
                await getSupabase()
                  .from('commander_member_comp_log')
                  .insert({
                    venue_id: session.venue_id,
                    member_id: session.member_id,
                    amount: compEarned,
                    type: 'auto_hourly',
                    reason: `Auto comp: ${elapsedMinutes} min × $${rate}/hr`,
                    balance_after: Math.round(((member.comp_balance || 0) + compEarned) * 100) / 100
                  });
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
