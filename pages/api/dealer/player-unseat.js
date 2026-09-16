/**
 * Player Unseat API - Staff-guarded tablet endpoint
 * POST /api/commander/dealer/player-unseat
 *
 * Removes a player from a table. Returns unused time to member balance (Texas mode).
 * Awards auto-comps based on session duration.
 *
 * Body: { session_id } OR { table_number, seat_number }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';
import { guardStaff } from '../../../src/lib/commander/auth';

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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      // 2026-07-29 (decision A): dealer tablets (Commander "Table Tablets" and the
      // social-media pages) already ship a signed x-staff-session header, so this
      // route now requires staff auth. It matters most here: player-unseat credits
      // unused minutes back to the member balance and writes comp rows, so an
      // anonymous caller could seat/unseat-cycle it as a comp-farming primitive.
      // guardStaff verifies the HMAC and sends 401 itself on failure.
      const staff = await guardStaff(req, res);
      if (!staff) return;

      const { session_id, table_number, seat_number, venue_id } = req.body;

      if (!session_id && (!table_number || !seat_number)) {
          return res.status(400).json({
              success: false,
              error: 'session_id or (table_number + seat_number) required'
          });
      }

      // 2026-07-28 audit fix (revised): venue_id is OPTIONAL, deliberately.
      //
      // Making it mandatory would buy no security here: this route is
      // unauthenticated, so an attacker simply supplies whatever venue_id they
      // like and reaches any venue either way. The real defect is the ACCIDENTAL
      // case - table_number/seat_number are not globally unique, so two clubs
      // both have a table 1 seat 1 and an unscoped match silently ends whichever
      // session the planner happened to return first. That matters here because
      // this route has financial side effects (credits time_balance_minutes,
      // awards comps, writes commander_member_comp_log).
      //
      // So: scope by venue when we are given one, and otherwise require the
      // table+seat pair to resolve to exactly ONE session - refusing with 409 if
      // it genuinely collides across venues. That fails loudly in precisely the
      // case that used to be silently wrong, and breaks no caller. (An earlier
      // revision today made this a hard 400 and broke three callers that had
      // never sent venue_id.)
      const venueId = Number(venue_id);
      const hasVenueId = Number.isInteger(venueId) && venueId >= 1;

      try {
          // Find the active session
          let sessionQuery = getSupabase()
              .from('commander_table_sessions')
              .select('*')
              .in('status', ['active', 'paused', 'meal_break'])
                  .limit(100);

          if (hasVenueId) sessionQuery = sessionQuery.eq('venue_id', venueId);

          if (session_id) {
              sessionQuery = sessionQuery.eq('id', session_id)
                  .limit(100);
          } else {
              sessionQuery = sessionQuery
                  .eq('table_number', parseInt(table_number))
                  .eq('seat_number', parseInt(seat_number))
                      .limit(100);
          }

          // Fetch 2, not 1, so a genuine cross-venue collision is detectable.
          const { data: sessions, error: fetchError } = await sessionQuery.limit(2);
          if (fetchError) throw fetchError;

          // Ambiguity guard. Only reachable on the unscoped table+seat path:
          // session_id is a primary key, so it can never match twice.
          if (!hasVenueId && !session_id && sessions?.length > 1) {
              return res.status(409).json({
                  success: false,
                  error: 'table_number/seat_number matches sessions at more than one venue - supply venue_id to disambiguate'
              });
          }

          const session = sessions?.[0];
          if (!session) {
              // Fallback: no session record, but seat might still be occupied (legacy/seeded data)
              if (table_number && seat_number) {
                  try {
                      // Follow-up A: this fallback CLEARS the seat it finds, so an
                      // unscoped table+seat match here is a cross-venue WRITE - it can
                      // empty another club's occupied seat. Same rule as above: scope
                      // when we have a venue, otherwise demand an unambiguous match.
                      let seatQuery = getSupabase()
                          .from('commander_table_seats')
                          .select('*')
                          .eq('table_number', parseInt(table_number))
                          .eq('seat_number', parseInt(seat_number))
                          .eq('status', 'occupied');

                      if (hasVenueId) seatQuery = seatQuery.eq('venue_id', venueId);

                      const { data: seatRows } = await seatQuery.limit(2);

                      if (!hasVenueId && seatRows?.length > 1) {
                          return res.status(409).json({
                              success: false,
                              error: 'table_number/seat_number matches occupied seats at more than one venue - supply venue_id to disambiguate'
                          });
                      }

                      if (seatRows?.[0]) {
                          const seatRow = seatRows[0];
                          await getSupabase()
                              .from('commander_table_seats')
                              .update({ status: 'empty', player_name: null, member_id: null, seated_at: null })
                              .eq('venue_id', seatRow.venue_id)
                              .eq('table_number', seatRow.table_number)
                              .eq('seat_number', seatRow.seat_number);

                          return res.status(200).json({
                              success: true,
                              data: {
                                  session_id: null,
                                  player_name: seatRow.player_name || 'Unknown',
                                  elapsed_minutes: 0,
                                  unused_minutes_returned: 0,
                                  comp_earned: 0,
                              }
                          });
                      }
                  } catch (e) {
                      console.warn('Fallback seat clear failed:', e.message);
                  }
              }
              return res.status(404).json({ success: false, error: 'No active session found' });
          }

          const now = new Date();
          const totalAllocatedSeconds = ((session.time_allocated_minutes || 0) + (session.time_added_minutes || 0)) * 60;
          const elapsedSeconds = Math.floor((now - new Date(session.started_at)) / 1000);
          const unusedSeconds = Math.max(0, totalAllocatedSeconds - elapsedSeconds);
          const unusedMinutes = Math.floor(unusedSeconds / 60);
          const elapsedMinutes = Math.floor(elapsedSeconds / 60);

          // End the session.
          // 2026-07-28 audit fix: this wrote status='ended' unconditionally, so
          // two concurrent unseats (a double-tapped tablet button is enough)
          // both saw an active session, both ended it, and BOTH ran the
          // time refund and the auto-comp below - the member got the unused
          // minutes back twice and was comped twice for one session. Atomic
          // arithmetic alone does not fix that; the payout has to belong to
          // whichever caller actually performs the active -> ended transition.
          // commander_end_table_session claims that transition
          // (UPDATE ... WHERE status <> 'ended' RETURNING *) and returns NULL
          // to everyone else, so the loser reports the seat as already cleared
          // and pays nothing out.
          const { data: endedSession, error: endError } = await getSupabase()
              .rpc('commander_end_table_session', { p_session_id: session.id, p_ended_by: 'tablet' });

          if (endError) throw endError;
          if (!endedSession || !endedSession.id) {
              return res.status(200).json({
                  success: true,
                  data: {
                      session_id: session.id,
                      player_name: session.player_name || 'Unknown',
                      elapsed_minutes: elapsedMinutes,
                      unused_minutes_returned: 0,
                      comp_earned: 0,
                      already_ended: true
                  }
              });
          }

          // Return unused time to member balance (Texas cash games ONLY - NEVER tournaments)
          // Tournament tables use a one-time seat fee; no time was deducted, so none to return.
          let isTournamentSession = false;
          if (session.venue_id && session.table_number) {
              const { data: tableRow } = await getSupabase()
                  .from('commander_tables')
                  .select('mode, table_purpose')
                  .eq('table_number', session.table_number)
                  .eq('venue_id', session.venue_id)
                  .maybeSingle();
              isTournamentSession = tableRow?.mode === 'tournament' || tableRow?.table_purpose === 'tournament';
          }

          if (!isTournamentSession && session.member_id && unusedMinutes > 0 && session.time_allocated_minutes > 0) {
              try {
                  // 2026-07-28 audit fix: was select time_balance_minutes -> add
                  // in JS -> write the sum back, so a concurrent write between
                  // the read and the write was erased.
                  // commander_adjust_member_balances applies
                  // time_balance_minutes = time_balance_minutes + delta in one
                  // statement.
                  const { error: refundError } = await getSupabase()
                      .rpc('commander_adjust_member_balances', {
                          p_member_id: session.member_id,
                          p_comp_delta: 0,
                          p_time_delta: unusedMinutes,
                          p_earned_delta: 0,
                          p_redeemed_delta: 0
                      });
                  if (refundError) {
                      console.error('[dealer/player-unseat] FAILED to refund unused minutes:', {
                          session_id: session.id,
                          member_id: session.member_id,
                          unused_minutes: unusedMinutes,
                          error: refundError.message || refundError
                      });
                  }
              } catch (e) {
                  console.warn('Time return failed (non-fatal):', e.message);
              }
          }

          // Auto-comp: award hourly comps based on play duration
          let compEarned = 0;
          if (session.member_id && session.venue_id) {
              try {
                  const { data: venueSettings } = await getSupabase()
                      .from('commander_venue_settings')
                      .select('auto_comp_rate')
                      .eq('venue_id', session.venue_id)
                      .maybeSingle();

                  const rate = parseFloat(venueSettings?.auto_comp_rate || 0);
                  if (rate > 0) {
                      compEarned = Math.round((elapsedMinutes / 60) * rate * 100) / 100;
                      if (compEarned > 0) {
                          // 2026-07-28 audit fix: was select comp_balance /
                          // comp_lifetime_earned -> add in JS -> write the sums
                          // back, losing any concurrent write.
                          // commander_txn_award_comp writes the comp_log row and
                          // applies comp_balance = comp_balance + delta in one
                          // transaction, stamping balance_after from the balance
                          // the increment actually produced rather than from the
                          // stale read. The idempotency key is derived from the
                          // session id, so the auto-comp for a given session can
                          // only ever be granted once.
                          const { data: compResult, error: compRpcErr } = await getSupabase()
                              .rpc('commander_txn_award_comp', {
                                  p_member_id: session.member_id,
                                  p_venue_id: session.venue_id,
                                  p_log_amount: compEarned,
                                  p_comp_delta: compEarned,
                                  p_time_delta: 0,
                                  p_earned_delta: compEarned,
                                  p_redeemed_delta: 0,
                                  p_type: 'auto_hourly',
                                  p_reason: `Auto comp: ${elapsedMinutes} min play`,
                                  p_comp_category: 'auto_hourly',
                                  p_idempotency_key: `auto_hourly:${session.id}`
                              });

                          if (compRpcErr) {
                              console.warn('Auto-comp award failed (non-fatal):', compRpcErr.message || compRpcErr);
                              compEarned = 0;
                          } else if (compResult?.replayed === true) {
                              compEarned = 0;
                          }
                      }
                  }
              } catch (e) {
                  console.warn('Auto-comp award failed (non-fatal):', e.message);
              }
          }

          // Clear the seat
          try {
              await getSupabase()
                  .from('commander_table_seats')
                  .update({
                      status: 'empty',
                      player_name: null,
                      member_id: null,
                      seated_at: null
                  })
                  .eq('venue_id', session.venue_id)
                  .eq('table_number', session.table_number)
                  .eq('seat_number', session.seat_number);
          } catch (e) {
              console.warn('Seat clear failed (non-fatal):', e.message);
          }

          return res.status(200).json({
              success: true,
              data: {
                  session_id: session.id,
                  player_name: session.player_name,
                  elapsed_minutes: elapsedMinutes,
                  unused_minutes_returned: unusedMinutes,
                  comp_earned: compEarned
              }
          });
      } catch (err) {
          console.warn('Player unseat error:', err);
          return res.status(500).json({ success: false, error: err.message });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
