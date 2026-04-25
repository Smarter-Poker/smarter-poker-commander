/**
 * Update Chips API
 * PUT /api/commander/tournaments/[id]/entries/[entryId]/chips
 * Updates a player's current chip count
 * Used by TD for chip count updates at breaks or manual corrections
 */
import { createClient } from '../../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../../src/lib/sentryWrap';

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

    if (req.method !== 'PUT') {
      res.setHeader('Allow', ['PUT']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id: tournamentId, entryId } = req.query;
    if (!tournamentId || !entryId) {
      return res.status(400).json({ success: false, error: 'Tournament ID and Entry ID required' });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      const { data: tournament } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id')
        .eq('id', tournamentId)
        .maybeSingle();
      if (!tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });


      const { chips } = req.body;
      if (chips === undefined || chips < 0) {
        return res.status(400).json({ success: false, error: 'Valid chip count required (>= 0)' });
      }

      const { data: entry } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_name, current_chips, status, metadata')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });

      const previousChips = entry.current_chips || 0;

      const { data: updated, error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          current_chips: chips,
          metadata: {
            ...(entry.metadata || {}),
            chip_updated_at: new Date().toISOString(),
            previous_chips: previousChips,
            updated_by: _g.id || null
          }
        })
        .eq('id', entryId)
        .select()
        .maybeSingle();

      if (uErr) return res.status(500).json({ success: false, error: 'Failed to update chips' });

      return res.status(200).json({
        success: true,
        data: {
          entry_id: entryId,
          player_name: entry.player_name,
          previous_chips: previousChips,
          current_chips: chips
        }
      });
    } catch (err) {
      console.warn('Update chips error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
