/**
 * Tournament Addon API
 * POST /api/commander/tournaments/[id]/entries/[entryId]/addon
 * Processes an add-on for a tournament player
 * Adds chips, sets addon_taken flag (one-time only)
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

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
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
        .select('id, venue_id, allows_addon, addon_cost, addon_chips, addon_level')
        .eq('id', tournamentId)
        .maybeSingle();
      if (!tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });


      if (!tournament.allows_addon) {
        return res.status(400).json({ success: false, error: 'Add-ons not allowed in this tournament' });
      }

      const { data: entry } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });

      if (!['active', 'seated'].includes(entry.status)) {
        return res.status(400).json({ success: false, error: 'Player must be active to take add-on' });
      }

      if (entry.addon_taken) {
        return res.status(400).json({ success: false, error: 'Player has already taken their add-on' });
      }

      const addonChips = tournament.addon_chips || tournament.starting_chips || 10000;
      const newChips = (entry.current_chips || 0) + addonChips;

      const { data: updated, error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          current_chips: newChips,
          addon_taken: true,
          metadata: {
            ...(entry.metadata || {}),
            addon_at: new Date().toISOString()
          }
        })
        .eq('id', entryId)
        .select()
        .maybeSingle();

      if (uErr) return res.status(500).json({ success: false, error: 'Failed to process add-on' });

      // --- FINANCIAL FRAUD PROTECTION ---
      // Log the cash collected by the TD into the cashier vault
      if (tournament.addon_cost > 0) {
        await getSupabase().from('commander_cash_transactions').insert({
          venue_id: tournament.venue_id,
          player_name: entry.player_name,
          type: 'buy_in',
          amount: tournament.addon_cost,
          payment_method: 'cash',
          processed_by: _g.id || null, // staff ID from guardWriteStaff
          notes: `Tournament Add-on: ${entry.player_name} (ID: ${entryId})`
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          entry_id: entryId,
          player_name: entry.player_name,
          chips_added: addonChips,
          total_chips: newChips,
          cost: tournament.addon_cost || 0
        }
      });
    } catch (err) {
      console.warn('Addon error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
