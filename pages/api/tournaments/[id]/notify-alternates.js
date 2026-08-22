/**
 * Notify Alternates API
 * POST /api/commander/tournaments/[id]/notify-alternates
 *
 * Tells every waiting alternate where they are in the queue ("You Are 2nd In
 * Line") plus an estimated wait derived from how fast the field is actually
 * busting tonight. The queue position itself has existed since the alternates
 * flow shipped; this is the part that reaches the player.
 *
 * Body (all optional):
 *   { limit: 3 }              only the first N in the queue
 *   { entry_ids: ["..."] }    only these entries, with their true positions
 *
 * Auth: STAFF - any floor staff at the tournament's venue.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../src/lib/commander/audit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { notifyAlternates } from '../../../../src/lib/commander/alternateNotifications';

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

    const { id: tournamentId } = req.query;

    const { data: tournament, error: tErr } = await getSupabase()
      .from('commander_tournaments')
      .select('id, venue_id, name, status')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tErr || !tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }

    // Venue scoping: staff can only message their own room's players.
    if (staff.venue_id !== undefined && staff.venue_id !== null
      && String(staff.venue_id) !== String(tournament.venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' }
      });
    }

    const rawLimit = req.body?.limit;
    const limit = (rawLimit === undefined || rawLimit === null || rawLimit === '')
      ? undefined
      : Math.max(1, Math.min(200, parseInt(rawLimit, 10) || 0));

    const entryIds = Array.isArray(req.body?.entry_ids)
      ? req.body.entry_ids.filter(v => typeof v === 'string' && v.trim()).slice(0, 200)
      : undefined;

    const result = await notifyAlternates(getSupabase(), {
      tournament,
      limit,
      entryIds
    });

    if (result.alternates.length === 0) {
      return res.status(200).json({
        success: true,
        data: { ...result, message: 'No Waiting Alternates To Notify.' }
      });
    }

    await logAction({ action: 'notify_alternates', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: tournamentId,
      targetType: 'commander_tournaments',
      targetName: tournament.name || 'Tournament',
      metadata: {
        tournament_id: tournamentId,
        alternates: result.alternates.length,
        notified: result.notified,
        skipped_opt_out: result.skipped_opt_out
      },
      req
    });

    const parts = [`${result.notified.toLocaleString()} Alternate${result.notified === 1 ? '' : 's'} Notified`];
    if (result.skipped_opt_out > 0) {
      parts.push(`${result.skipped_opt_out.toLocaleString()} Opted Out Of Push`);
    }
    const unreachable = result.alternates.filter(a => a.reason === 'NO_LINKED_ACCOUNT').length;
    if (unreachable > 0) {
      parts.push(`${unreachable.toLocaleString()} Have No Linked Account, Call Them On The Floor`);
    }

    return res.status(200).json({
      success: true,
      data: { ...result, message: `${parts.join('. ')}.` }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[notify-alternates] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed To Notify Alternates' }
      });
    }
  }
}
