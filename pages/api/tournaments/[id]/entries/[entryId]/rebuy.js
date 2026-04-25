/**
 * Tournament Rebuy API
 * POST /api/commander/tournaments/[id]/entries/[entryId]/rebuy
 * Processes a rebuy for a tournament player
 * Increments rebuy_count, adds chips, validates rebuy eligibility
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

      // Get tournament
      const { data: tournament } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id, status, allows_rebuys, rebuy_cost, rebuy_chips, rebuy_levels, max_rebuys, current_level, clock_state')
        .eq('id', tournamentId)
        .maybeSingle();
      if (!tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });


      // Validate rebuys allowed
      if (!tournament.allows_rebuys) {
        return res.status(400).json({ success: false, error: 'Rebuys not allowed in this tournament' });
      }

      // Check rebuy period
      const currentLevel = tournament.clock_state?.current_level || tournament.current_level || 0;
      if (tournament.rebuy_levels && currentLevel > tournament.rebuy_levels) {
        return res.status(400).json({ success: false, error: `Rebuy period closed (ended at level ${tournament.rebuy_levels})` });
      }

      // Get entry
      const { data: entry } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });

      if (entry.status === 'eliminated') {
        return res.status(400).json({ success: false, error: 'Player is eliminated. Use re-entry instead.' });
      }

      // Check max rebuys
      const maxRebuys = tournament.max_rebuys || 999;
      if ((entry.rebuy_count || 0) >= maxRebuys) {
        return res.status(400).json({ success: false, error: `Maximum rebuys (${maxRebuys}) reached` });
      }

      const rebuyChips = tournament.rebuy_chips || tournament.starting_chips || 10000;
      const newChips = (entry.current_chips || 0) + rebuyChips;
      const newRebuyCount = (entry.rebuy_count || 0) + 1;

      const { data: updated, error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          current_chips: newChips,
          rebuy_count: newRebuyCount,
          status: 'active',
          metadata: {
            ...(entry.metadata || {}),
            last_rebuy_at: new Date().toISOString(),
            last_rebuy_level: currentLevel
          }
        })
        .eq('id', entryId)
        .select()
        .maybeSingle();

      if (uErr) return res.status(500).json({ success: false, error: 'Failed to process rebuy' });

      // --- FINANCIAL FRAUD PROTECTION ---
      // Log the cash collected by the TD into the cashier vault
      if (tournament.rebuy_cost > 0) {
        await getSupabase().from('commander_cash_transactions').insert({
          venue_id: tournament.venue_id,
          player_name: entry.player_name,
          type: 'buy_in',
          amount: tournament.rebuy_cost,
          payment_method: 'cash',
          processed_by: _g.id || null, // staff ID from guardWriteStaff
          notes: `Tournament Rebuy: ${entry.player_name} (ID: ${entryId})`
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          entry_id: entryId,
          player_name: entry.player_name,
          rebuy_number: newRebuyCount,
          chips_added: rebuyChips,
          total_chips: newChips,
          cost: tournament.rebuy_cost || 0,
          rebuys_remaining: maxRebuys - newRebuyCount
        }
      });
    } catch (err) {
      console.warn('Rebuy error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
