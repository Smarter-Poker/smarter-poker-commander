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

    // Staff auth: kiosk devices must have a valid staff session
    const staffSession = req.headers['x-staff-session'];
    if (staffSession) {
      try {
        const sessionData = JSON.parse(staffSession);
        const { data: staff } = await getSupabase()
          .from('commander_staff')
          .select('id, venue_id, is_active')
          .eq('id', sessionData.id)
          .eq('is_active', true)
          .maybeSingle();
        if (!staff) {
          return res.status(401).json({ success: false, error: 'Invalid staff session' });
        }
      } catch {
        return res.status(401).json({ success: false, error: 'Invalid session format' });
      }
    } else {
      return res.status(401).json({ success: false, error: 'Staff authentication required' });
    }

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

      const currentBalance = member.time_balance_minutes || 0;
      const newBalance = currentBalance + parseInt(minutes);

      // Update member balance
      const { error: updateError } = await getSupabase()
        .from('commander_members')
        .update({
          time_balance_minutes: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', member_id);

      if (updateError) throw updateError;

      // Log the purchase
      await getSupabase()
        .from('commander_time_purchases')
        .insert({
          venue_id: member.venue_id,
          member_id: member.id,
          minutes_purchased: parseInt(minutes),
          amount_paid: amount ? parseFloat(amount) : null,
          payment_method: payment_method || 'kiosk',
          purchased_by: 'kiosk_self_service'
        });

      // Also add time to active session if player is currently seated
      const { data: activeSession } = await getSupabase()
        .from('commander_table_sessions')
        .select('id, time_added_minutes')
        .eq('member_id', member_id)
        .eq('status', 'active')
        .limit(1);

      if (activeSession?.length > 0) {
        // Player is at a table — add time to their active session too
        await getSupabase()
          .from('commander_table_sessions')
          .update({
            time_added_minutes: (activeSession[0].time_added_minutes || 0) + parseInt(minutes),
            updated_at: new Date().toISOString()
          })
          .eq('id', activeSession[0].id);
      }

      return res.status(200).json({
        success: true,
        data: {
          member_id,
          minutes_added: parseInt(minutes),
          previous_balance: currentBalance,
          new_balance: newBalance,
          added_to_active_session: activeSession?.length > 0
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
