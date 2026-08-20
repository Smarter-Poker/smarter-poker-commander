/**
 * Undo Elimination (Restore Entry) API
 * POST /api/commander/tournaments/[id]/entries/[entryId]/restore
 *
 * Floor staff safety valve: a mistaken bust-out is reversed in one tap.
 * - Entry returns to 'active' with finish_position/eliminated_at/eliminated_by cleared.
 * - A bounty that was awarded to the eliminator is clawed back (floored at 0).
 * - Refuses to restore when a payout has already been recorded for the entry
 *   (send force: true after voiding the payout on the Payouts screen).
 * - Only allowed while the tournament is running/paused/final_table.
 */
import { createClient } from '../../../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../../../src/lib/commander/audit';
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

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
      });
    }
    if (!applyRateLimit(req, res, LIMITS.write)) return;
    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { id: tournamentId, entryId } = req.query;
    const force = req.body?.force === true;

    const [{ data: tournament }, { data: entry }] = await Promise.all([
      getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id, name, status, bounty_amount')
        .eq('id', tournamentId)
        .maybeSingle(),
      getSupabase()
        .from('commander_tournament_entries')
        .select('*')
        .eq('id', entryId)
        .eq('tournament_id', tournamentId)
        .maybeSingle()
    ]);

    if (!tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Entry Not Found' }
      });
    }
    if (!['running', 'paused', 'final_table'].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'TOURNAMENT_NOT_ACTIVE', message: 'Restore Is Only Available While The Tournament Is Active' }
      });
    }
    if (!['eliminated', 'winner'].includes(entry.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'NOT_ELIMINATED', message: 'Entry Is Not Eliminated' }
      });
    }
    if ((entry.payout_amount || 0) > 0 && !force) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'PAYOUT_RECORDED',
          message: 'A Payout Is Recorded For This Entry. Void It On The Payouts Screen, Then Retry With Force.'
        }
      });
    }

    // Conditional update so a double-tap or concurrent restore cannot double-apply.
    const { data: restored, error: restoreError } = await getSupabase()
      .from('commander_tournament_entries')
      .update({
        status: 'active',
        finish_position: null,
        eliminated_at: null,
        eliminated_by: null,
        ...(force ? { payout_amount: null, payout_position: null, payout_status: null } : {})
      })
      .eq('id', entryId)
      .eq('tournament_id', tournamentId)
      .in('status', ['eliminated', 'winner'])
      .select()
      .maybeSingle();

    if (restoreError) throw restoreError;
    if (!restored) {
      return res.status(409).json({
        success: false,
        error: { code: 'ALREADY_RESTORED', message: 'Entry Was Already Restored By Another Client' }
      });
    }

    // Claw back the bounty that the eliminator collected for this bust.
    let bountyReversed = false;
    if ((tournament.bounty_amount || 0) > 0 && entry.eliminated_by) {
      const { data: eliminator } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, bounties_collected')
        .eq('tournament_id', tournamentId)
        .eq('player_id', entry.eliminated_by)
        .in('status', ['seated', 'active', 'registered'])
        .maybeSingle();
      if (eliminator && (eliminator.bounties_collected || 0) > 0) {
        const { error: bountyError } = await getSupabase()
          .from('commander_tournament_entries')
          .update({ bounties_collected: (eliminator.bounties_collected || 0) - 1 })
          .eq('id', eliminator.id);
        if (!bountyError) bountyReversed = true;
        else console.warn('[restore.js] Bounty claw-back failed:', bountyError.message);
      }
    }

    await logAction({ action: 'restore_entry', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: entryId,
      targetType: 'commander_tournament_entries',
      targetName: entry.player_name || 'Player',
      metadata: {
        tournament_id: tournamentId,
        previous_status: entry.status,
        previous_finish_position: entry.finish_position,
        bounty_reversed: bountyReversed,
        forced: force
      },
      req
    });

    return res.status(200).json({
      success: true,
      data: {
        entry: restored,
        bounty_reversed: bountyReversed,
        message: 'Elimination Undone. Player Is Back In The Field.'
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[restore.js] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed To Restore Entry' }
      });
    }
  }
}
