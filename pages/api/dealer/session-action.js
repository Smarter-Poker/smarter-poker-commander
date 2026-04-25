/**
 * Session Action API — Unified player action endpoint
 * POST /api/commander/dealer/session-action
 * 
 * Actions: pause, resume, meal_break, missed_blinds, move
 * Body: { table_number, seat_number, action, target_seat? }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

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

      const { table_number, seat_number, action, target_seat, venue_id } = req.body;

      if (!table_number && action !== 'tournament_chip_update') {
          return res.status(400).json({ success: false, error: 'table_number required' });
      }
      if (!action) {
          return res.status(400).json({ success: false, error: 'action required' });
      }

      // ── Tournament chip update — bypasses session lookup ──
      if (action === 'tournament_chip_update') {
          const { tournament_id, entry_id, chip_count } = req.body;
          if (!tournament_id || !entry_id || (chip_count === undefined && chip_count !== 0)) {
              return res.status(400).json({ success: false, error: 'tournament_id, entry_id, and chip_count required' });
          }
          try {
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
          const { data: sessions, error: fetchError } = await getSupabase()
              .from('commander_table_sessions')
              .select('*')
              .eq('table_number', parseInt(table_number))
              .eq('seat_number', parseInt(seat_number))
              .in('status', ['active', 'paused', 'meal_break'])
              .limit(1);

          if (fetchError) throw fetchError;
          const session = sessions?.[0];

          if (!session) {
              return res.status(404).json({ success: false, error: 'No active session at this seat' });
          }

          // TOURNAMENT GUARD: Block timer-based actions for tournament sessions
          // Move is still allowed — dealers need to move tournament players between tables
          if (['pause', 'resume', 'meal_break', 'missed_blinds'].includes(action)) {
              const { data: tableRow } = await getSupabase()
                  .from('commander_tables')
                  .select('mode')
                  .eq('table_number', parseInt(table_number))
                  .eq('venue_id', session.venue_id)
                  .maybeSingle();

              if (tableRow?.mode === 'tournament') {
                  return res.status(400).json({
                      success: false,
                      error: 'Timer actions are not available for tournament sessions — tournaments have no individual timers'
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
                      return res.status(400).json({ success: false, error: `${session.player_name} is on meal break — resume first` });
                  }
                  const { error } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({ status: 'paused', updated_at: new Date().toISOString() })
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
                  const { error } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({ status: 'active', updated_at: new Date().toISOString() })
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
                  const { error } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({ status: 'meal_break', updated_at: new Date().toISOString() })
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

              /* ─── MOVE PLAYER ──────────────────────────── */
              case 'move': {
                  if (!target_seat) {
                      return res.status(400).json({ success: false, error: 'target_seat required for move action' });
                  }

                  const targetSeatNum = parseInt(target_seat);

                  // Check target seat is empty
                  const { data: occupied } = await getSupabase()
                      .from('commander_table_sessions')
                      .select('id, player_name')
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
                  const venueIdVal = venue_id || session.venue_id;
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

              /* ─── UPDATE CHIP COUNT (Tournament) ─── */
              case 'update_chip_count': {
                  const chipCount = req.body?.chip_count;
                  if (!chipCount && chipCount !== 0) {
                      return res.status(400).json({ success: false, error: 'chip_count required' });
                  }
                  const { error } = await getSupabase()
                      .from('commander_table_sessions')
                      .update({
                          chip_count: parseInt(chipCount),
                          updated_at: new Date().toISOString(),
                      })
                      .eq('id', session.id);
                  if (error) throw error;
                  return res.status(200).json({
                      success: true,
                      data: {
                          action: 'update_chip_count',
                          player_name: session.player_name,
                          session_id: session.id,
                          chip_count: parseInt(chipCount),
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
