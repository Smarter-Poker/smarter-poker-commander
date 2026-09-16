/**
 * Call Waitlist Player
 * POST /api/commander/waitlist/call
 * Marks player as 'called', sends an SMS when a phone number is on file, and
 * fires a seat-ready push to app users (who frequently have no phone on file).
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { sendSeatNotification, isTwilioConfigured } from '../../../src/lib/commander/twilio';
import { notifySeatReady } from '../../../src/lib/commander/pushNotifications';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
import { logAction, AuditActions } from '../../../src/lib/commander/audit';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
      const staff = _g; // from guardWriteStaff
      const { waitlist_id, table_number } = req.body;
      if (!waitlist_id) return res.status(400).json({ success: false, error: 'waitlist_id required' });

      // Get current waitlist entry
      const { data: entry } = await getSupabase()
        .from('commander_waitlist')
        .select('*')
        .eq('id', waitlist_id)
        .maybeSingle();

      if (!entry) return res.status(404).json({ success: false, error: 'Waitlist entry not found' });
      if (entry.status !== 'waiting') {
        return res.status(400).json({ success: false, error: `Player already ${entry.status}` });
      }

      // Update status to called
      const { data, error } = await getSupabase()
        .from('commander_waitlist')
        .update({
          status: 'called',
          last_called_at: new Date().toISOString(),
          call_count: (entry.call_count || 0) + 1
        })
        .eq('id', waitlist_id)
        .select()
        .maybeSingle();

      if (error) return res.status(500).json({ success: false, error: 'Internal server error' });

      // Resolve venue name + game label ONCE - both the SMS and the push use them.
      // (These used to live inside the phone-only branch, so the push path below
      // could not reuse them.)
      let venueName = 'Your poker room';
      try {
        const { data: venue } = await getSupabase()
          .from('poker_venues')
          .select('name')
          .eq('id', entry.venue_id)
          .maybeSingle();
        if (venue?.name) venueName = venue.name;
      } catch (e) { console.warn('[App] Handled exception:', e); }

      const gameLabel = `${entry.stakes || ''} ${(entry.game_type || 'Cash Game').toUpperCase()}`.trim();
      const tableInfo = table_number ? ` at Table ${table_number}` : '';

      // Send SMS notification if phone on file
      let smsResult = null;
      if (entry.player_phone) {
        if (isTwilioConfigured()) {
          smsResult = await sendSeatNotification(
            entry.player_phone,
            venueName,
            `${gameLabel}${tableInfo}`,
            { timeout: 5 }
          );
        } else {
          smsResult = { success: false, reason: 'Twilio not configured' };
        }
      }

      // Seat-ready push for app users. notifySeatReady already existed but was
      // never called, so remote joiners without a phone number received nothing.
      // Non-fatal: a push failure must never fail the call itself.
      let pushResult = null;
      if (entry.player_id) {
        try {
          pushResult = await notifySeatReady(
            entry.player_id,
            venueName,
            gameLabel,
            table_number || ''
          );
        } catch (pushErr) {
          console.warn('[waitlist/call] push failed:', pushErr?.message || pushErr);
          pushResult = { success: false, reason: 'push_error' };
        }
      }

      // Audit log
      await logAction(AuditActions.WAITLIST_CALL, {
        venueId: staff.venue_id,
        staffId: staff.id,
        targetId: waitlist_id,
        targetType: 'commander_waitlist',
        targetName: entry.player_name || 'Player',
        metadata: { table_number },
        req
      });

      return res.status(200).json({
        success: true,
        data: {
          ...data,
          sms_sent: smsResult?.success || false,
          sms_status: smsResult?.success ? 'sent' : (entry.player_phone ? (smsResult?.reason || 'no_config') : 'no_phone'),
          push_sent: pushResult?.success || false,
          push_status: pushResult?.success ? 'sent' : (entry.player_id ? (pushResult?.reason || 'no_config') : 'no_player_id'),
        }
      });
    } catch (err) {
      console.warn('Waitlist call error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
