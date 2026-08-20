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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' } });

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Read the current clock_state so the new message merges into it
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('id, settings')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });

      const { message, type, duration_seconds } = req.body;
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Message Text Required' } });
      }

      const msgType = type || 'announcement'; // announcement, alert, info, break_table, hand_for_hand
      const duration = duration_seconds || 30;

      // Store message in clock state so display screens can read it
      // (there is no clock_state column - clock state lives in the settings
      // jsonb at settings.clock_state, same as clock.js).
      const settings = tournament.settings || {};
      const clockState = settings.clock_state || {};
      const messages = Array.isArray(clockState.messages) ? clockState.messages : [];
      const newMessage = {
        id: `msg_${Date.now()}`,
        // Cap the stored text so the settings blob cannot be bloated
        text: message.trim().slice(0, 500),
        type: msgType,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + duration * 1000).toISOString(),
        created_by: 'staff'
      };

      messages.push(newMessage);
      // Keep only last 20 messages
      const trimmedMessages = messages.slice(-20);

      // Persist via the atomic commander_clock_write RPC (jsonb_set on
      // settings.clock_state) so a concurrent settings write from another
      // tablet is never clobbered by a whole-blob update.
      const { error: uErr } = await getSupabase().rpc('commander_clock_write', {
        p_tournament_id: tournamentId,
        p_clock_state: {
          ...clockState,
          messages: trimmedMessages,
          current_message: newMessage
        }
      });

      if (uErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Broadcast Message' } });

      return res.status(200).json({
        success: true,
        data: {
          message: newMessage,
          broadcast: true
        }
      });
    } catch (err) {
      console.warn('Tournament message error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
