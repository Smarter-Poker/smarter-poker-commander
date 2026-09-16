/**
 * Update Chips API
 * PUT /api/commander/tournaments/[id]/entries/[entryId]/chips
 * Updates a player's current chip count
 * Used by TD for chip count updates at breaks or manual corrections
 */
import { createClient } from '../../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../../src/lib/apiErrorHandler';
import { logAction } from '../../../../../../src/lib/commander/audit';
import { denyCrossVenue } from '../../../../../../src/lib/commander/venueScope';

// Chip counts feed ICM equity, i.e. money. Bound them below the integer
// current_chips column so a hostile value cannot overflow it.
const MAX_CHIPS = 2000000000;

// How many corrections are kept on the entry itself. The full history is in the
// audit log; this is the tail the floor can see without leaving the screen, and
// it is capped so a repeatedly corrected stack cannot grow the row without
// bound (this jsonb ships in the floor-view payload to every tablet).
const MAX_CHIP_CORRECTIONS = 20;

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

/**
 * Resolve the verified session to the identity fields commander_audit_logs can
 * actually store.
 *
 * commander_audit_logs.staff_id is an FK to commander_staff. verifyStaffSession
 * returns a SYNTHETIC staff object for an owner who has no commander_staff row
 * (its `id` is an auth user id, see auth.js Path 2 fallback), and writing that
 * into staff_id violates the FK. logAudit swallows the RPC error, so the
 * correction would have been made with NO audit row at all, silently, for
 * exactly the person most likely to make it.
 *
 * Returns { staffId, userId }: a real staff row when there is one, otherwise the
 * user id (an FK to profiles, which an owner id satisfies) so the actor is still
 * recorded.
 */
async function resolveAuditActor(session) {
  if (!session?.id) return { staffId: null, userId: null };

  const { data, error } = await getSupabase()
    .from('commander_staff')
    .select('id')
    .eq('id', session.id)
    .maybeSingle();

  if (error) {
    console.warn('[tournaments/entries/chips] commander_staff lookup failed, attributing by user id:', error.message);
    return { staffId: null, userId: session.id };
  }
  if (data) return { staffId: data.id, userId: null };
  return { staffId: null, userId: session.id };
}

// Auth: any active staff session for THIS venue (guardStaff + denyCrossVenue).
// NOT role-gated. This header used to claim "requires manager or owner
// role"; neither guardStaff nor guardWriteStaff performs any role check,
// so every role in commander_staff - including dealer and brush - passes.
// Stated accurately rather than aspirationally: a comment that overstates
// the guard is worse than none, because the next reader trusts it.
// Whether the cash-taking routes SHOULD be manager-only is a product
// decision, not a bug fix - see .agent/audits/.
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
      
      // Venue scope: a valid session for one room must never reach
      // another room's tournament. See src/lib/commander/venueScope.js.
      if (denyCrossVenue(res, _g, tournament)) return;


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
      const delta = parsedChips - previousChips;
      const correctedAt = new Date().toISOString();

      // CHIP CORRECTION AUDIT TRAIL (2026-08-20)
      //
      // A TD could overwrite a stack with no before/after record anywhere: the
      // row simply held a new number and the old one was gone. Chip counts feed
      // ICM, chip-chop deals and the payout screen, i.e. money, so every
      // correction is now recorded twice:
      //
      //  1. On the entry, as metadata.chip_corrections (the last
      //     MAX_CHIP_CORRECTIONS). The history travels with the row and is
      //     visible on the floor without querying the audit log.
      //  2. In the audit log via logAction, with the before/after and the delta.
      //
      // Oldest entries are dropped first, so index 0 is always the earliest kept
      // correction and the last element is the most recent.
      const priorCorrections = Array.isArray(entry.metadata?.chip_corrections)
        ? entry.metadata.chip_corrections
        : [];
      const correction = {
        from: previousChips,
        to: parsedChips,
        delta,
        by: _g.id || null,
        at: correctedAt
      };
      const chipCorrections = [...priorCorrections, correction].slice(-MAX_CHIP_CORRECTIONS);

      const { data: updated, error: uErr } = await getSupabase()
        .from('commander_tournament_entries')
        .update({
          current_chips: parsedChips,
          metadata: {
            ...(entry.metadata || {}),
            chip_updated_at: correctedAt,
            previous_chips: previousChips,
            updated_by: _g.id || null,
            chip_corrections: chipCorrections
          }
        })
        .eq('id', entryId)
        .select()
        .maybeSingle();

      if (uErr) {
        console.error('[tournaments/entries/chips] chip write failed', {
          tournamentId, entryId, code: uErr.code, message: uErr.message, details: uErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Update Chips' } });
      }

      // Audit log. Written AFTER the successful write so the log never records a
      // correction that did not happen. A logging failure is swallowed inside
      // logAudit and can never fail the correction itself.
      const actor = await resolveAuditActor(_g);
      await logAction({ action: 'correct_chip_count', category: 'tournament' }, {
        venueId: tournament.venue_id,
        staffId: actor.staffId,
        userId: actor.userId,
        actorType: 'staff',
        targetId: entryId,
        targetType: 'commander_tournament_entries',
        targetName: entry.player_name || 'Player',
        changes: { current_chips: { old: previousChips, new: parsedChips } },
        metadata: {
          tournament_id: tournamentId,
          entry_id: entryId,
          // logAudit accepts targetName but does not forward it to
          // log_audit_event, so the name is carried in metadata where it is
          // actually persisted.
          player_name: entry.player_name || null,
          previous_chips: previousChips,
          new_chips: parsedChips,
          delta,
          entry_status: entry.status
        },
        req
      });

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
          current_chips: parsedChips,
          delta,
          corrected_at: correctedAt,
          correction_count: chipCorrections.length
        }
      });
    } catch (err) {
      console.warn('Update chips error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
