/**
 * Session Action API - Unified player action endpoint
 * POST /api/commander/dealer/session-action
 *
 * Actions: pause, resume, meal_break, missed_blinds, move, add_time
 * Body: { table_number, seat_number, action, target_seat? }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';
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
      // route can require staff auth with no UI change. guardStaff verifies the
      // HMAC and resolves the staff row, sending 401 itself on failure. Anonymous
      // callers can no longer pause billing timers, move players between seats, or
      // read player names back off this endpoint.
      const staff = await guardStaff(req, res);
      if (!staff) return;

      const { table_number, seat_number, action, target_seat, venue_id } = req.body;

      if (!table_number && action !== 'tournament_chip_update') {
          return res.status(400).json({ success: false, error: 'table_number required' });
      }
      if (!action) {
          return res.status(400).json({ success: false, error: 'action required' });
      }

      // 2026-07-28 audit fix (revised): venue_id is OPTIONAL, deliberately.
      //
      // Making it mandatory would buy no security here: this route is
      // unauthenticated, so an attacker just supplies whatever venue_id they like
      // and reaches any venue either way. The real defect is the ACCIDENTAL case -
      // table_number/seat_number are not globally unique, so two clubs both have a
      // table 1 seat 1 and an unscoped match silently acts on whichever session the
      // planner returned first.
      //
      // So: scope by venue when we are given one, and otherwise require the
      // table+seat pair to resolve to exactly ONE session - refusing with 409 if it
      // genuinely collides across venues. That fails loudly in exactly the case that
      // used to be silently wrong, and breaks no caller. (An earlier revision today
      // made this a hard 400 and broke three callers that never sent venue_id.)
      const venueId = Number(venue_id);
      const hasVenueId = Number.isInteger(venueId) && venueId >= 1;

      // ── Tournament chip update - bypasses session lookup ──
      if (action === 'tournament_chip_update') {
          const { tournament_id, entry_id, chip_count } = req.body;
          if (!tournament_id || !entry_id || (chip_count === undefined && chip_count !== 0)) {
              return res.status(400).json({ success: false, error: 'tournament_id, entry_id, and chip_count required' });
          }
          try {
              // 2026-07-28 audit fix: this branch skips the session lookup, so it
              // previously wrote chip counts for ANY entry_id + tournament_id with no
              // venue check at all. commander_tournament_entries has no venue_id of
              // its own; ownership resolves through commander_tournaments.
              //
              // No ambiguity guard is needed when venue_id is absent: tournament_id
              // and entry_id are UUIDs, so they already identify exactly one row
              // globally - unlike table_number/seat_number, which collide across
              // venues. We only assert ownership when a venue was actually supplied.
              if (hasVenueId) {
                  const { data: tourney, error: tErr } = await getSupabase()
                      .from('commander_tournaments')
                      .select('id')
                      .eq('id', tournament_id)
                      .eq('venue_id', venueId)
                      .maybeSingle();
                  if (tErr) throw tErr;
                  if (!tourney) {
                      return res.status(404).json({ success: false, error: 'Tournament not found' });
                  }
              }

              const { data: entry, error: eErr } = await getSupabase()
                  .from('commander_tournament_entries')
                  .update({ current_chips: parseInt(chip_count) })
                  .eq('id', entry_id)
                  .eq('tournament_id', tournament_id)
                  .select('id, player_name, current_chips')
                  .maybeSingle();
              if (eErr) throw eErr;
              return res.status(200).json({ success: true, data: { action: 'tournament_chip_update', player_name: entry.player_name, entry_id: entry.id, chip_count: entry.current_chips } });
          } catch (err) {
              console.warn('Tournament chip update error:', err);
              return res.status(500).json({ success: false, error: err.message });
          }
      }

      if (!seat_number) {
          return res.status(400).json({ success: false, error: 'seat_number required' });
      }

      try {
          // Find the active session
          let sessionQuery = getSupabase()
              .from('commander_table_sessions')
              .select('*')
              .eq('table_number', parseInt(table_number))
              .eq('seat_number', parseInt(seat_number))
              .in('status', ['active', 'paused', 'meal_break']);

          if (hasVenueId) sessionQuery = sessionQuery.eq('venue_id', venueId);

          // Fetch 2, not 1, so a genuine cross-venue collision is detectable.
          const { data: sessions, error: fetchError } = await sessionQuery.limit(2);

          if (fetchError) throw fetchError;

          if (!hasVenueId && sessions?.length > 1) {
              return res.status(409).json({
                  success: false,
                  error: 'table_number/seat_number matches sessions at more than one venue - supply venue_id to disambiguate'
              });
          }

          const session = sessions?.[0];

          if (!session) {
              return res.status(404).json({ success: false, error: 'No active session at this seat' });
          }

          // TOURNAMENT GUARD: Block timer-based actions for tournament sessions
          // Move is still allowed - dealers need to move tournament players between tables
          if (['pause', 'resume', 'meal_break', 'missed_blinds', 'add_time'].includes(action)) {
              const { data: tableRow } = await getSupabase()
                  .from('commander_tables')
                  .select('mode')
                  .eq('table_number', parseInt(table_number))
                  .eq('venue_id', session.venue_id)
                  .maybeSingle();

              if (tableRow?.mode === 'tournament') {
                  return res.status(400).json({
                      success: false,
                      error: 'Timer actions are not available for tournament sessions - tournaments have no individual timers'
                  });
              }
          }

          switch (action) {
              /* ─── PAUSE TIMER ──────────────────────────── */
              case 'pause': {
                  if (session.status === 'paused') {
                      return res.status(200).json({ success: true, data: { action: 'pause', player_name: session.player_name, session_id: session.id, note: 'Already paused' } });
                  }
                  if (session.status === 'meal_break') {
                      return res.status(400).json({ success: false, error: `${session.player_name} is on meal break - resume first` });
                  }
                  // Stamp paused_at so billing freezes. Preserve an existing stamp if
                  // one somehow survives, so we never restart an in-progress span.
                  const { error } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({ status: 'paused', paused_at: session.paused_at || new Date().toISOString(), updated_at: new Date().toISOString() })
                      .eq('id', session.id);
                  if (error) throw error;
                  return res.status(200).json({
                      success: true,
                      data: { action: 'pause', player_name: session.player_name, session_id: session.id }
                  });
              }

              /* ─── RESUME TIMER ─────────────────────────── */
              case 'resume': {
                  if (session.status === 'active') {
                      return res.status(200).json({ success: true, data: { action: 'resume', player_name: session.player_name, session_id: session.id, note: 'Already active' } });
                  }
                  // Fold the just-ended paused span into total_paused_minutes and clear
                  // paused_at, so the billing clock (which subtracts paused time) picks
                  // up exactly where it froze.
                  const pausedSpanMinutes = session.paused_at
                      ? Math.max(0, Math.round((Date.now() - new Date(session.paused_at).getTime()) / 60000))
                      : 0;
                  const newTotalPaused = (session.total_paused_minutes || 0) + pausedSpanMinutes;
                  const { error } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({ status: 'active', paused_at: null, total_paused_minutes: newTotalPaused, updated_at: new Date().toISOString() })
                      .eq('id', session.id);
                  if (error) throw error;
                  return res.status(200).json({
                      success: true,
                      data: { action: 'resume', player_name: session.player_name, session_id: session.id }
                  });
              }

              /* ─── MEAL BREAK (30 min) ──────────────────── */
              case 'meal_break': {
                  if (session.status === 'meal_break') {
                      return res.status(200).json({ success: true, data: { action: 'meal_break', player_name: session.player_name, session_id: session.id, duration_minutes: 30, note: 'Already on meal break' } });
                  }
                  // Meal break freezes billing too. If the seat was already paused,
                  // keep the original paused_at so the running span is not reset.
                  const { error } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({ status: 'meal_break', paused_at: session.paused_at || new Date().toISOString(), updated_at: new Date().toISOString() })
                      .eq('id', session.id);
                  if (error) throw error;
                  return res.status(200).json({
                      success: true,
                      data: {
                          action: 'meal_break',
                          player_name: session.player_name,
                          session_id: session.id,
                          duration_minutes: 30
                      }
                  });
              }

              /* ─── MISSED BLINDS ────────────────────────── */
              case 'missed_blinds': {
                  // Increment missed blinds counter
                  const currentMissed = session.missed_blinds || 0;
                  const { error } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({
                          missed_blinds: currentMissed + 1,
                          updated_at: new Date().toISOString(),
                      })
                      .eq('id', session.id);

                  if (error) throw error;

                  return res.status(200).json({
                      success: true,
                      data: {
                          action: 'missed_blinds',
                          player_name: session.player_name,
                          session_id: session.id,
                          missed_blinds_count: currentMissed + 1
                      }
                  });
              }

              /* --- ADD TIME (buy more banked minutes) --- */
              case 'add_time': {
                  const addMinutes = parseInt(req.body.minutes, 10);
                  if (!Number.isInteger(addMinutes) || addMinutes <= 0) {
                      return res.status(400).json({ success: false, error: 'minutes must be a positive integer' });
                  }
                  const { data: updated, error } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({ time_added_minutes: (session.time_added_minutes || 0) + addMinutes, updated_at: new Date().toISOString() })
                      .eq('id', session.id)
                      .select('id, player_name, time_added_minutes')
                      .maybeSingle();
                  if (error) throw error;
                  return res.status(200).json({
                      success: true,
                      data: { action: 'add_time', player_name: updated?.player_name || session.player_name, session_id: session.id, minutes_added: addMinutes, time_added_minutes: updated?.time_added_minutes }
                  });
              }

              /* ─── MOVE PLAYER ──────────────────────────── */
              case 'move': {
                  if (!target_seat) {
                      return res.status(400).json({ success: false, error: 'target_seat required for move action' });
                  }

                  const targetSeatNum = parseInt(target_seat);

                  // Check target seat is empty.
                  // Follow-up A: scoped to the venue of the session we actually found.
                  // Unscoped, an unrelated club's table N seat M could make this seat
                  // look occupied - and worse, the error below interpolates that other
                  // venue's player_name into a string returned to an unauthenticated
                  // caller, leaking a name across venues. session.venue_id is always
                  // known here, so this needs no conditional.
                  const { data: occupied } = await getSupabase()
                      .from('commander_table_sessions')
                      .select('id, player_name')
                      .eq('venue_id', session.venue_id)
                      .eq('table_number', parseInt(table_number))
                      .eq('seat_number', targetSeatNum)
                      .in('status', ['active', 'paused', 'meal_break'])
                      .limit(1);

                  if (occupied?.length > 0) {
                      return res.status(400).json({
                          success: false,
                          error: `Seat ${targetSeatNum} is occupied by ${occupied[0].player_name}`
                      });
                  }

                  // Move: update session seat_number
                  const { error: moveError } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({
                          seat_number: targetSeatNum,
                          updated_at: new Date().toISOString(),
                      })
                      .eq('id', session.id);

                  if (moveError) throw moveError;

                  // Update seat records
                  // 2026-07-28 audit fix: was `venue_id || session.venue_id`, which
                  // let the request body decide WHERE the seat writes landed. The body
                  // value may only narrow the lookup - never redirect a write.
                  const venueIdVal = session.venue_id;
                  // Clear old seat
                  await getSupabase()
                      .from('commander_table_seats')
                      .update({ status: 'empty', player_name: null, member_id: null, seated_at: null })
                      .eq('venue_id', venueIdVal)
                      .eq('table_number', parseInt(table_number))
                      .eq('seat_number', parseInt(seat_number));

                  // Occupy new seat
                  await getSupabase()
                      .from('commander_table_seats')
                      .upsert({
                          venue_id: venueIdVal,
                          table_number: parseInt(table_number),
                          seat_number: targetSeatNum,
                          status: 'occupied',
                          player_name: session.player_name,
                          member_id: session.member_id,
                          seated_at: new Date().toISOString()
                      }, { onConflict: 'venue_id,table_number,seat_number' });

                  return res.status(200).json({
                      success: true,
                      data: {
                          action: 'move',
                          player_name: session.player_name,
                          from_seat: parseInt(seat_number),
                          to_seat: targetSeatNum,
                          session_id: session.id
                      }
                  });
              }

              default:
                  return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
          }
      } catch (err) {
          console.warn('Session action error:', err);
          return res.status(500).json({ success: false, error: err.message });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
