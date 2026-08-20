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

    const { id: tournamentId, entryId } = req.query;
    if (!tournamentId || !entryId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID And Entry ID Required' } });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament
      // 2026-07-25 audit fix: rebuy_cost/rebuy_levels/clock_state are not real
      // columns - use rebuy_amount/rebuy_end_level; clock state lives in settings.
      const { data: tournament } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id, status, allows_rebuys, rebuy_amount, rebuy_chips, rebuy_end_level, max_rebuys, current_level, starting_chips')
        .eq('id', tournamentId)
        .maybeSingle();
      if (!tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });


      // Validate rebuys allowed
      if (!tournament.allows_rebuys) {
        return res.status(400).json({ success: false, error: { code: 'REBUYS_NOT_ALLOWED', message: 'Rebuys Not Allowed In This Tournament' } });
      }

      // Check rebuy period
      // 2026-07-25 audit fix: current_level is 0-indexed; the rebuy period runs
      // while (current_level + 1) <= rebuy_end_level when a cutoff is set.
      const currentLevel = tournament.current_level || 0;
      if (tournament.rebuy_end_level && (currentLevel + 1) > tournament.rebuy_end_level) {
        return res.status(400).json({ success: false, error: { code: 'REBUY_PERIOD_CLOSED', message: `Rebuy Period Closed (Ended At Level ${tournament.rebuy_end_level})` } });
      }

      // Get entry
      const { data: entry } = await getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (!entry) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entry Not Found' } });

      if (entry.status === 'eliminated') {
        return res.status(400).json({ success: false, error: { code: 'PLAYER_ELIMINATED', message: 'Player Is Eliminated. Use Re-Entry Instead.' } });
      }

      // Check max rebuys
      const maxRebuys = tournament.max_rebuys || 999;
      if ((entry.rebuy_count || 0) >= maxRebuys) {
        return res.status(400).json({ success: false, error: { code: 'MAX_REBUYS_REACHED', message: `Maximum Rebuys (${maxRebuys}) Reached` } });
      }

      const rebuyChips = tournament.rebuy_chips || tournament.starting_chips || 10000;

      // 2026-07-28 audit fix: this used to read current_chips/rebuy_count, add
      // in JS and write the sums back, with the max-rebuy check done against the
      // value it had already read. Two concurrent rebuys - a double-tapped
      // button is enough - both read the same counts, both passed the max check
      // and the second write erased the first: the player got one lot of chips,
      // the vault got charged twice, and rebuy_count advanced by one.
      //
      // commander_txn_tournament_rebuy does all of it in one transaction:
      // current_chips = current_chips + delta, rebuy_count = rebuy_count + 1
      // with the max-rebuy test moved into the UPDATE predicate, plus the cash
      // ledger row. The checks above are kept because they produce the friendly
      // messages the TD screen renders; the RPC is the authority.
      //
      // idempotency_key is optional; on a resubmission the ORIGINAL cash
      // transaction is returned with success and no chips or cash move again.
      const idempotencyKey = typeof req.body?.idempotency_key === 'string' && req.body.idempotency_key.trim()
        ? req.body.idempotency_key.trim().slice(0, 200)
        : null;

      const { data: result, error: uErr } = await getSupabase()
        .rpc('commander_txn_tournament_rebuy', {
          p_entry_id: entryId,
          p_tournament_id: tournamentId,
          p_chips: rebuyChips,
          p_max_rebuys: maxRebuys,
          p_level: currentLevel,
          p_venue_id: tournament.venue_id,
          p_amount: tournament.rebuy_amount || 0,
          p_player_name: entry.player_name,
          p_processed_by: _g.id || null, // staff ID from guardWriteStaff
          p_idempotency_key: idempotencyKey
        });

      if (uErr) {
        if (uErr.code === 'P0002') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entry Not Found' } });
        if (uErr.code === 'P0001') return res.status(400).json({ success: false, error: { code: 'REBUY_REJECTED', message: uErr.message || 'Rebuy Rejected' } });
        console.warn('Rebuy RPC error:', uErr);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Process Rebuy' } });
      }

      const updatedEntry = result?.entry || {};
      const newRebuyCount = updatedEntry.rebuy_count ?? ((entry.rebuy_count || 0) + 1);
      const newChips = updatedEntry.current_chips ?? ((entry.current_chips || 0) + rebuyChips);

      // Response shape unchanged.
      return res.status(200).json({
        success: true,
        data: {
          entry_id: entryId,
          player_name: entry.player_name,
          rebuy_number: newRebuyCount,
          chips_added: rebuyChips,
          total_chips: newChips,
          cost: tournament.rebuy_amount || 0, // 2026-07-25 audit fix: real column
          rebuys_remaining: maxRebuys - newRebuyCount,
          replayed: result?.replayed === true
        }
      });
    } catch (err) {
      console.warn('Rebuy error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
