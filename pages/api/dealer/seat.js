/**
 * Dealer Seat Player API
 * POST /api/commander/dealer/seat
 * 
 * Seats a scanned member at a specific table/seat.
 * Creates an active table session with time countdown.
 * Deducts time_minutes from member's time_balance_minutes.
 * 
 * Body: { member_id, table_number, seat_number, time_minutes }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
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

    const { member_id, table_number, seat_number, time_minutes } = req.body;

    if (!member_id || !table_number || !seat_number) {
      return res.status(400).json({ success: false, error: 'member_id, table_number, and seat_number are required' });
    }

    try {
      // Get member details
      const { data: member, error: memberError } = await getSupabase()
        .from('commander_members')
        .select('*')
        .eq('id', member_id)
        .maybeSingle();

      if (memberError || !member) {
        return res.status(404).json({ success: false, error: 'Member not found' });
      }

      // Verify membership is active
      if (member.membership_status === 'suspended' ||
        member.membership_status === 'banned' ||
        member.membership_status === 'expired' ||
        member.membership_status === 'inactive') {
        return res.status(400).json({ success: false, error: 'Membership is not active' });
      }

      // Verify time balance
      const availableTime = member.time_balance_minutes || 0;
      if (availableTime <= 0) {
        return res.status(400).json({ success: false, error: 'No time remaining on card. Player must add time first.' });
      }

      // Check if member already has an active session
      const { data: existing } = await getSupabase()
        .from('commander_table_sessions')
        .select('id, table_number, seat_number')
        .eq('member_id', member_id)
        .in('status', ['active', 'paused', 'meal_break'])
        .limit(1);

      if (existing?.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Player already seated at Table ${existing[0].table_number} Seat ${existing[0].seat_number}`
        });
      }

      // Check if seat is already occupied
      const { data: seatTaken } = await getSupabase()
        .from('commander_table_sessions')
        .select('id, player_name')
        .eq('table_number', table_number)
        .eq('seat_number', seat_number)
        .in('status', ['active', 'paused', 'meal_break'])
        .limit(1);

      if (seatTaken?.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Seat ${seat_number} already occupied by ${seatTaken[0].player_name}`
        });
      }

      // Use all available time from card.
      // 2026-07-28 audit fix: this allocated `availableTime` — a value read
      // several statements earlier — onto the new session and then, in a
      // separate write, set time_balance_minutes to 0. Two concurrent seat
      // requests for the same member both read the same balance, both created a
      // session carrying the full balance, and both zeroed it: the player got
      // the minutes twice for one payment. The seat/duplicate-session checks
      // above are advisory for the same reason — they read before they write.
      // commander_claim_member_time_minutes locks the member row, reads the
      // balance and zeroes it in one transaction, returning exactly what it
      // took, so only one caller can ever claim a given block of minutes.
      const { data: claimedMinutes, error: claimError } = await getSupabase()
        .rpc('commander_claim_member_time_minutes', { p_member_id: member.id });

      if (claimError) {
        console.warn('Time claim error:', claimError);
        return res.status(500).json({ success: false, error: 'Failed to reserve time from card' });
      }
      if (!claimedMinutes || claimedMinutes <= 0) {
        // Another request claimed the balance between the check above and here.
        return res.status(400).json({ success: false, error: 'No time remaining on card. Player must add time first.' });
      }

      const timeToAllocate = claimedMinutes;

      // Create active session
      const { data: session, error: sessionError } = await getSupabase()
        .from('commander_table_sessions')
        .insert({
          venue_id: member.venue_id,
          member_id: member.id,
          player_name: `${member.first_name} ${member.last_name}`.trim(),
          table_number: parseInt(table_number),
          seat_number: parseInt(seat_number),
          time_allocated_minutes: timeToAllocate,
          time_added_minutes: 0,
          membership_tier: member.membership_tier,
          member_number: member.member_number,
          status: 'active',
          started_at: new Date().toISOString()
        })
        .select()
        .maybeSingle();

      if (sessionError) {
        // The minutes are already off the card. Put them back rather than
        // leaving the player short for a session that does not exist.
        const { error: rollbackError } = await getSupabase()
          .rpc('commander_adjust_member_balances', {
            p_member_id: member.id,
            p_comp_delta: 0,
            p_time_delta: claimedMinutes,
            p_earned_delta: 0,
            p_redeemed_delta: 0
          });
        if (rollbackError) {
          console.error('[dealer/seat] CRITICAL: session insert failed AND the claimed minutes could not be returned:', {
            member_id: member.id,
            claimed_minutes: claimedMinutes,
            error: rollbackError.message || rollbackError
          });
        }
        throw sessionError;
      }

      // Visit tracking. The time deduction that used to live in this update is
      // now done atomically by commander_claim_member_time_minutes above; these
      // columns are not money and are left as a plain update.
      const { error: visitError } = await getSupabase()
        .from('commander_members')
        .update({
          last_visit: new Date().toISOString(),
          total_visits: (member.total_visits || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', member.id);

      if (visitError) console.warn('Visit tracking error:', visitError);

      // Update table seat status
      await getSupabase()
        .from('commander_table_seats')
        .upsert({
          venue_id: member.venue_id,
          table_number: parseInt(table_number),
          seat_number: parseInt(seat_number),
          status: 'occupied',
          player_name: `${member.first_name} ${member.last_name}`.trim(),
          member_id: member.id,
          seated_at: new Date().toISOString()
        }, { onConflict: 'venue_id,table_number,seat_number' });

      // Log check-in
      await getSupabase()
        .from('commander_checkins')
        .insert({
          member_id: member.id,
          venue_id: member.venue_id,
          checked_in_at: new Date().toISOString()
        });

      return res.status(200).json({
        success: true,
        data: {
          session_id: session.id,
          player_name: session.player_name,
          table_number: session.table_number,
          seat_number: session.seat_number,
          time_allocated_minutes: timeToAllocate,
          started_at: session.started_at
        }
      });
    } catch (err) {
      console.warn('Dealer seat error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
