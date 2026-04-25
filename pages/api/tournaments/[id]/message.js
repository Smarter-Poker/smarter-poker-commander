/**
 * Tournament Message API
 * POST /api/commander/tournaments/[id]/message
 * Broadcasts a message to tournament clock displays
 * Messages appear on TV/projector clock screens and can push to players
 * Used for announcements like "Table 3 is breaking", "Hand for hand", "Color up"
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

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

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Tournament ID required' });

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament for clock_state
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });

      const { message, type, duration_seconds } = req.body;
      if (!message || message.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Message text required' });
      }

      const msgType = type || 'announcement'; // announcement, alert, info, break_table, hand_for_hand
      const duration = duration_seconds || 30;

      // Store message in clock_state so display screens can read it
      const clockState = tournament.clock_state || {};
      const messages = clockState.messages || [];
      const newMessage = {
        id: `msg_${Date.now()}`,
        text: message.trim(),
        type: msgType,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + duration * 1000).toISOString(),
        created_by: 'staff'
      };

      messages.push(newMessage);
      // Keep only last 20 messages
      const trimmedMessages = messages.slice(-20);

      const { error: uErr } = await getSupabase()
        .from('commander_tournaments')
        .update({
          clock_state: {
            ...clockState,
            messages: trimmedMessages,
            current_message: newMessage
          }
        })
        .eq('id', tournamentId);

      if (uErr) return res.status(500).json({ success: false, error: 'Failed to broadcast message' });

      return res.status(200).json({
        success: true,
        data: {
          message: newMessage,
          broadcast: true
        }
      });
    } catch (err) {
      console.warn('Tournament message error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
