/**
 * Hand-for-Hand API
 * POST /api/commander/tournaments/[id]/hand-for-hand
 * Toggles hand-for-hand mode (bubble play)
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { denyCrossVenue } from '../../../../src/lib/commander/venueScope';

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

      // Read the current clock_state so the toggle merges into it
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id, settings')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
      
      // Venue scope: a valid session for one room must never reach
      // another room's tournament. See src/lib/commander/venueScope.js.
      if (denyCrossVenue(res, _g, tournament)) return;

      const { active } = req.body;
      // Read clock_state from settings JSONB (canonical path - matches clock.js and floor-view.js)
      const settings = tournament.settings || {};
      const clockState = settings.clock_state || {};

      const updatedClockState = {
        ...clockState,
        hand_for_hand: active !== false,
        hand_for_hand_started_at: active !== false ? new Date().toISOString() : null
      };

      // Persist via the atomic commander_clock_write RPC (jsonb_set on
      // settings.clock_state) so a concurrent settings write from another
      // tablet is never clobbered by a whole-blob update.
      const { error: uErr } = await getSupabase().rpc('commander_clock_write', {
        p_tournament_id: tournamentId,
        p_clock_state: updatedClockState
      });

      if (uErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Update Hand-For-Hand State' } });

      return res.status(200).json({
        success: true,
        data: {
          hand_for_hand: updatedClockState.hand_for_hand,
          started_at: updatedClockState.hand_for_hand_started_at
        }
      });
    } catch (err) {
      console.warn('Hand-for-hand error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
