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

// Chip counts feed ICM equity, i.e. money. Bound them below the integer
// current_chips column so a hostile value cannot overflow it.
const MAX_CHIPS = 2000000000;

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

    if (req.method !== 'PUT') {
      res.setHeader('Allow', ['PUT']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const { id: tournamentId, entryId } = req.query;
    if (!tournamentId || !entryId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID And Entry ID Required' } });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      const { data: tournament } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id, day_end_chip_counts')
        .eq('id', tournamentId)
        .maybeSingle();
      if (!tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });


      const { chips } = req.body;
      // 2026-07-28 audit fix: `chips === undefined || chips < 0` let non-numeric
      // values through - "abc" < 0 is false - and the raw value was written to
      // current_chips, which feeds the ICM equity calculation, i.e. money.
      // Coerce explicitly and require a finite, non-negative integer in range.
      const parsedChips = (typeof chips === 'number' || typeof chips === 'string')
        ? Number(chips)
        : NaN;
      if (!Number.isFinite(parsedChips) || !Number.isInteger(parsedChips) || parsedChips < 0 || parsedChips > MAX_CHIPS) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Valid Chip Count Required (A Whole Number From 0 To ${MAX_CHIPS.toLocaleString()})` } });
      }

      const { data: entry } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_name, current_chips, status, metadata')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle();
      if (!entry) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entry Not Found' } });

      const previousChips = entry.current_chips || 0;

      const { data: updated, error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          current_chips: parsedChips,
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

      if (uErr) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Update Chips' } });

      // Multi-day: a 'bagged' player's stack also lives in the tournament's
      // day_end_chip_counts record, which is what the morning is reconciled
      // against. Correcting the entry without correcting that record leaves
      // two different numbers for the same bag, so keep them in step.
      if (entry.status === 'bagged') {
        const raw = tournament.day_end_chip_counts;
        const counts = Array.isArray(raw)
          ? Object.fromEntries((raw).filter(r => r?.entry_id).map(r => [String(r.entry_id), r]))
          : (raw && typeof raw === 'object' ? { ...raw } : {});
        const existing = counts[String(entryId)] || {};
        counts[String(entryId)] = {
          ...existing,
          player_name: existing.player_name ?? entry.player_name ?? null,
          chips: parsedChips,
          corrected_at: new Date().toISOString(),
          corrected_from: previousChips
        };
        const { error: syncErr } = await getSupabase()
          .from('commander_tournaments')
          .update({ day_end_chip_counts: counts })
          .eq('id', tournamentId);
        // Never fail the chip update over this: the entry is already correct
        // and that is the number every screen reads.
        if (syncErr) console.warn('[chips.js] day_end_chip_counts sync failed:', syncErr.message);
      }

      return res.status(200).json({
        success: true,
        data: {
          entry_id: entryId,
          player_name: entry.player_name,
          previous_chips: previousChips,
          current_chips: parsedChips
        }
      });
    } catch (err) {
      console.warn('Update chips error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
