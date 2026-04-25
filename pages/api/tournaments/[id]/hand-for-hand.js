/**
 * Hand-for-Hand API
 * POST /api/commander/tournaments/[id]/hand-for-hand
 * Toggles hand-for-hand mode (bubble play)
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

      const { active } = req.body;
      // Read clock_state from settings JSONB (canonical path — matches clock.js and floor-view.js)
      const settings = tournament.settings || {};
      const clockState = settings.clock_state || {};

      const updatedClockState = {
        ...clockState,
        hand_for_hand: active !== false,
        hand_for_hand_started_at: active !== false ? new Date().toISOString() : null
      };

      const updatedSettings = { ...settings, clock_state: updatedClockState };

      const { error: uErr } = await getSupabase()
        .from('commander_tournaments')
        .update({ settings: updatedSettings })
        .eq('id', tournamentId);

      if (uErr) return res.status(500).json({ success: false, error: 'Failed to update' });

      return res.status(200).json({
        success: true,
        data: {
          hand_for_hand: updatedClockState.hand_for_hand,
          started_at: updatedClockState.hand_for_hand_started_at
        }
      });
    } catch (err) {
      console.warn('Hand-for-hand error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
