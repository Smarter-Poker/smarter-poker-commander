/**
 * Player Self-Update Chip Count API
 * POST /api/commander/tournaments/[id]/my-chips
 * 
 * Allows authenticated players to update their own chip count during a tournament.
 * Inspired by WSOP+ player self-report feature.
 * 
 * Security: Only the player themselves can update their own chips.
 * Validation: Tournament must be running, player must be active in the tournament.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { requireAuth } from '../../../../src/lib/commander/auth';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';

// Matches entries/[entryId]/chips.js: the staff-side writer of the same column.
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

// Auth: USER - requires authenticated user
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await requireAuth(req, res);
      if (!_staff) return;
    }

      if (!['GET', 'POST'].includes(req.method)) {
          res.setHeader('Allow', ['GET', 'POST']);
          return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
      }

      const { id: tournamentId } = req.query;

      // Authenticate player
      const authHeader = req.headers.authorization;
      if (!authHeader) {
          return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication Required' } });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
          return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Invalid Or Expired Token' } });
      }

      // GET returns the player's own live status, including their place in the
      // alternates queue. The hub page cannot compute that itself because RLS
      // hides other players' entries.
      if (req.method === 'GET') {
          const { data: myEntry } = await getSupabase()
              .from('commander_tournament_entries')
              .select('id, status, table_number, seat_number, current_chips, rebuy_count, addon_taken, finish_position, payout_amount, registered_at, created_at')
              .eq('tournament_id', tournamentId)
              .eq('player_id', user.id)
              .neq('status', 'cancelled')
              .order('registered_at', { ascending: false, nullsFirst: false })
              .limit(1)
              .maybeSingle();

          if (!myEntry) {
              return res.status(200).json({ success: true, data: { entry: null, queue_position: null } });
          }

          let queuePosition = null;
          let alternatesAhead = null;
          if (myEntry.status === 'alternate') {
              const { data: queue } = await getSupabase()
                  .from('commander_tournament_entries')
                  .select('id, registered_at, created_at')
                  .eq('tournament_id', tournamentId)
                  .eq('status', 'alternate')
                  .order('registered_at', { ascending: true, nullsFirst: false })
                  .order('created_at', { ascending: true })
                  .limit(500);
              const idx = (queue || []).findIndex(q => q.id === myEntry.id);
              if (idx >= 0) {
                  queuePosition = idx + 1;
                  alternatesAhead = idx;
              }
          }

          return res.status(200).json({
              success: true,
              data: { entry: myEntry, queue_position: queuePosition, alternates_ahead: alternatesAhead }
          });
      }

      try {
          const { chips } = req.body;

          // Upper bound matches chips.js MAX_CHIPS. Without it, Number('1e20')
          // passes isNaN and < 0, survives Math.floor, and the integer column
          // raises 22003 - a 500 for what is a validation error.
          const parsedChips = Number(chips);
          if (chips === undefined || chips === null || !Number.isFinite(parsedChips) ||
              parsedChips < 0 || parsedChips > MAX_CHIPS) {
              return res.status(400).json({
                  success: false,
                  error: { code: 'VALIDATION_ERROR', message: `Valid Chip Count Required (A Whole Number From 0 To ${MAX_CHIPS.toLocaleString()})` }
              });
          }

          // Verify tournament exists and is running
          const { data: tournament, error: tErr } = await getSupabase()
              .from('commander_tournaments')
              .select('id, status, name')
              .eq('id', tournamentId)
              .maybeSingle();

          if (tErr || !tournament) {
              return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
          }

          // commander_tournaments_status_check allows
          //   scheduled | registration | running | paused | final_table
          //   | completed | cancelled
          // There is no 'break' - the break toggle in clock.js sets status
          // 'paused' and flips clock_state.on_break. So this list tested for a
          // value that can never occur while OMITTING the one that actually
          // happens, and self-report returned 400 NOT_RUNNING for the whole
          // break: precisely the interval in which players count their stacks.
          // The feature was dead exactly when it was needed.
          if (!['running', 'paused', 'final_table'].includes(tournament.status)) {
              return res.status(400).json({ success: false, error: { code: 'NOT_RUNNING', message: 'Tournament Is Not Currently Running' } });
          }

          // Find the player's active entry
          const { data: entry, error: eErr } = await getSupabase()
              .from('commander_tournament_entries')
              .select('id, player_id, current_chips, status, metadata')
              .eq('tournament_id', tournamentId)
              .eq('player_id', user.id)
              // Player self-reported chip count. 'bagged' excluded on purpose:
              // between days the bagged count recorded by the floor is the
              // authoritative number and a player must not be able to type
              // over it. (The route also gates on a running tournament, and
              // bag-and-tag leaves the event 'paused'.)
              .in('status', ['active', 'seated', 'registered'])
              // A re-entry player has MORE THAN ONE row here, and maybeSingle()
              // errors on multiple rows rather than picking one - so eErr was
              // truthy and every re-entered player got 404 NOT_REGISTERED. The
              // GET branch above was fixed with exactly this order+limit;
              // the POST branch was left behind. Newest entry is the live one.
              .order('registered_at', { ascending: false, nullsFirst: false })
              .limit(1)
              .maybeSingle();

          if (eErr || !entry) {
              return res.status(404).json({ success: false, error: { code: 'NOT_REGISTERED', message: 'You Are Not Registered In This Tournament' } });
          }

          // Update chip count
          const previousChips = entry.current_chips || 0;
          const newChips = Math.floor(Number(chips));

          const { error: updateErr } = await getSupabase()
              .from('commander_tournament_entries')
              .update({
                  current_chips: newChips,
                  metadata: {
                      ...(entry.metadata || {}),
                      last_self_reported: new Date().toISOString(),
                      previous_chips: previousChips,
                      reported_by: 'player'
                  }
              })
              .eq('id', entry.id);

          if (updateErr) {
              console.warn('Update chips error:', updateErr);
              return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Update Chips' } });
          }

          return res.status(200).json({
              success: true,
              data: {
                  previous_chips: previousChips,
                  current_chips: newChips,
                  tournament_name: tournament.name
              }
          });
      } catch (err) {
          console.warn('My chips error:', err);
          return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
