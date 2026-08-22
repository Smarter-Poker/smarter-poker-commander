/**
 * Player Scan-In API - QR self-scan open; member_number fallback is staff-only
 * POST /api/commander/dealer/player-scan-in
 *
 * Combined scan + seat in one call for the tablet.
 * Dual mode:
 *   - Texas clubs: checks membership, checks time_balance, deducts time
 *   - Charity/Home games: just logs player + tracks duration (no time billing)
 *
 * Body: { qr_code, table_number, seat_number?, venue_id? }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';
import { verifyStaffSession } from '../../../src/lib/commander/auth';

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
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!applyRateLimit(req, res, LIMITS.write)) return;
      }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { qr_code, table_number, seat_number, venue_id } = req.body;

      if (!qr_code || !table_number) {
          return res.status(400).json({ success: false, error: 'qr_code and table_number are required' });
      }

      const tableNum = parseInt(table_number);
      if (isNaN(tableNum)) {
          return res.status(400).json({ success: false, error: 'table_number must be a number' });
      }

      try {
          // ── 1. Look up member by QR code (safe sequential, no .or()) ──
          let lookupCode = qr_code;
          if (qr_code.includes('/check-in/')) {
              const parts = qr_code.split('/');
              lookupCode = parts[parts.length - 1];
          }

          // Try QR code first
          let { data: members } = await getSupabase()
              .from('commander_members')
              .select('*')
              .eq('qr_code', lookupCode)
              .limit(1);

          // Fallback to member_number - 2026-07-29 (decision B): member numbers are
          // sequential (JAQK-00001, 00002, ...), so an open member_number lookup would
          // let anyone seat a member by guessing - and scanning a member in claims and
          // zeroes their prepaid time balance. The QR path keeps its entropy and stays
          // open for player self-scan; the typed-number fallback now requires a verified
          // staff session (the "card won't scan, staff types the number" case). When no
          // staff session is present and the QR did not match, we fall through to the
          // generic 404 below and never reveal that a member_number lookup exists.
          if (!members?.length) {
              const staffCheck = await verifyStaffSession(req);
              if (!staffCheck.error) {
                  const { data: byNumber } = await getSupabase()
                      .from('commander_members')
                      .select('*')
                      .eq('member_number', lookupCode)
                      .limit(1);
                  members = byNumber;
              }
          }

          const member = members?.[0];
          if (!member) {
              return res.status(404).json({ success: false, error: 'Member not found. QR code not recognized.' });
          }

          // ── 2. Get venue settings to determine mode ──
          // Priority: explicit venue_id > table's venue_id > member's venue_id
          let resolvedVenueId = venue_id || null;

          // Always look up the table's venue to ensure session venue_id matches tablet queries
          if (!resolvedVenueId) {
              const { data: tableInfo } = await getSupabase()
                  .from('commander_tables')
                  .select('venue_id')
                  .eq('table_number', tableNum)
                  .limit(1)
                  .maybeSingle();
              resolvedVenueId = tableInfo?.venue_id || member.venue_id;
          }

          let venueType = 'texas'; // default

          if (resolvedVenueId) {
              const { data: settings } = await getSupabase()
                  .from('commander_venue_settings')
                  .select('venue_type, time_billing_rate')
                  .eq('venue_id', resolvedVenueId)
                  .maybeSingle();

              if (settings?.venue_type) {
                  venueType = settings.venue_type;
              }
          }

          const isTimeBilledVenue = venueType === 'texas';

          // ── 2b. Tournament table check - NEVER bill time for tournaments ──
          // Tournaments use a one-time seat fee (rake), not time-based billing.
          let isTournamentTable = false;
          {
              const { data: tableRow } = await getSupabase()
                  .from('commander_tables')
                  .select('mode, table_purpose')
                  .eq('table_number', tableNum)
                  .eq('venue_id', resolvedVenueId)
                  .maybeSingle();
              isTournamentTable = tableRow?.mode === 'tournament' || tableRow?.table_purpose === 'tournament';
          }

          // Final billing decision: time-billed only if venue is texas AND table is NOT tournament
          const isTimeBilled = isTimeBilledVenue && !isTournamentTable;

          // ── 3. Check membership (Texas mode only, NEVER for tournaments) ──
          if (isTimeBilled) {
              const membershipActive =
                  member.membership_status !== 'suspended' &&
                  member.membership_status !== 'banned' &&
                  member.membership_status !== 'expired' &&
                  member.membership_status !== 'inactive';

              const isExpiredByDate = member.membership_expires &&
                  new Date(member.membership_expires) < new Date();

              if (!membershipActive || isExpiredByDate) {
                  return res.status(400).json({
                      success: false,
                      error: 'Membership is not active or has expired.',
                      member_name: `${member.first_name} ${member.last_name}`.trim()
                  });
              }

              // Check time balance
              const timeBalance = member.time_balance_minutes || 0;
              if (timeBalance <= 0) {
                  return res.status(400).json({
                      success: false,
                      error: 'No time remaining. Player must purchase time first.',
                      error_code: 'NO_TIME',
                      member_name: `${member.first_name} ${member.last_name}`.trim(),
                      member_id: member.id
                  });
              }
          }

          // ── 4. Check if already seated ──
          try {
              const { data: existing } = await getSupabase()
                  .from('commander_table_sessions')
                  .select('id, table_number, seat_number')
                  .eq('member_id', member.id)
                  .in('status', ['active', 'paused', 'meal_break'])
                  .limit(1);

              if (existing?.length > 0) {
                  return res.status(400).json({
                      success: false,
                      error: `Already seated at Table ${existing[0].table_number} Seat ${existing[0].seat_number}`,
                      error_code: 'ALREADY_SEATED',
                      member_name: `${member.first_name} ${member.last_name}`.trim()
                  });
              }
          } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

          // ── 5. Determine seat number ──
          let seatNum = seat_number ? parseInt(seat_number) : null;

          if (!seatNum) {
              // Auto-assign: find first available seat at this table
              const { data: table } = await getSupabase()
                  .from('commander_tables')
                  .select('max_seats')
                  .eq('table_number', tableNum)
                  .limit(1)
                  .maybeSingle();

              const maxSeats = table?.max_seats || 9;

              // Get occupied seats
              let occupiedSeats = [];
              try {
                  const { data: activeSessions } = await getSupabase()
                      .from('commander_table_sessions')
                      .select('seat_number')
                      .eq('table_number', tableNum)
                      .in('status', ['active', 'paused', 'meal_break']);
                  occupiedSeats = (activeSessions || []).map(s => s.seat_number);
              } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

              // Find first open seat
              for (let s = 1; s <= maxSeats; s++) {
                  if (!occupiedSeats.includes(s)) {
                      seatNum = s;
                      break;
                  }
              }

              if (!seatNum) {
                  return res.status(400).json({ success: false, error: 'Table is full - no seats available.' });
              }
          } else {
              // Check if requested seat is occupied
              try {
                  const { data: seatTaken } = await getSupabase()
                      .from('commander_table_sessions')
                      .select('id, player_name')
                      .eq('table_number', tableNum)
                      .eq('seat_number', seatNum)
                      .in('status', ['active', 'paused', 'meal_break'])
                      .limit(1);

                  if (seatTaken?.length > 0) {
                      return res.status(400).json({
                          success: false,
                          error: `Seat ${seatNum} is occupied by ${seatTaken[0].player_name}`
                      });
                  }
              } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
          }

          // ── 6. Create session ──
          const playerName = `${member.first_name} ${member.last_name}`.trim();
          // Tournament tables: allocate 0 time (no clock). Cash: allocate full balance.
          //
          // 2026-07-28 audit fix: this read member.time_balance_minutes - fetched
          // several statements earlier - allocated it onto the new session, and
          // then in a separate write set the balance to 0. Two concurrent
          // scan-ins for the same member both read the same balance, both
          // created a session carrying the full balance, and both zeroed it, so
          // the player got the minutes twice for one payment.
          // commander_claim_member_time_minutes locks the member row, reads the
          // balance and zeroes it in one transaction, returning exactly what it
          // took, so a block of minutes can only be claimed once.
          let timeToAllocate = 0;
          if (isTimeBilled) {
              const { data: claimedMinutes, error: claimError } = await getSupabase()
                  .rpc('commander_claim_member_time_minutes', { p_member_id: member.id });

              if (claimError) {
                  console.warn('Time claim error:', claimError);
                  return res.status(500).json({ success: false, error: 'Failed to reserve time from card' });
              }
              if (!claimedMinutes || claimedMinutes <= 0) {
                  // Another request claimed the balance since the check above.
                  return res.status(400).json({
                      success: false,
                      error: 'No time remaining. Player must purchase time first.',
                      error_code: 'NO_TIME',
                      member_name: playerName,
                      member_id: member.id
                  });
              }
              timeToAllocate = claimedMinutes;
          }

          const { data: session, error: sessionError } = await getSupabase()
              .from('commander_table_sessions')
              .insert({
                  venue_id: resolvedVenueId,
                  member_id: member.id,
                  player_name: playerName,
                  table_number: tableNum,
                  seat_number: seatNum,
                  time_allocated_minutes: timeToAllocate,
                  time_added_minutes: 0,
                  membership_tier: member.membership_tier || 'standard',
                  member_number: member.member_number,
                  status: 'active',
                  started_at: new Date().toISOString()
              })
              .select()
              .maybeSingle();

          if (sessionError) {
              // The minutes are already off the card. Put them back rather than
              // leaving the player short for a session that does not exist.
              if (timeToAllocate > 0) {
                  const { error: rollbackError } = await getSupabase()
                      .rpc('commander_adjust_member_balances', {
                          p_member_id: member.id,
                          p_comp_delta: 0,
                          p_time_delta: timeToAllocate,
                          p_earned_delta: 0,
                          p_redeemed_delta: 0
                      });
                  if (rollbackError) {
                      console.error('[dealer/player-scan-in] CRITICAL: session insert failed AND the claimed minutes could not be returned:', {
                          member_id: member.id,
                          claimed_minutes: timeToAllocate,
                          error: rollbackError.message || rollbackError
                      });
                  }
              }
              throw sessionError;
          }

          // ── 7. Visit tracking ──
          // The time deduction that used to live in this update is now done
          // atomically by commander_claim_member_time_minutes above (and only
          // for time-billed tables - tournaments still deduct nothing). These
          // columns are not money and are left as a plain update.
          await getSupabase()
              .from('commander_members')
              .update({
                  last_visit: new Date().toISOString(),
                  total_visits: (member.total_visits || 0) + 1,
                  updated_at: new Date().toISOString()
              })
              .eq('id', member.id);

          // ── 8. Update table seat status ──
          try {
              await getSupabase()
                  .from('commander_table_seats')
                  .upsert({
                      venue_id: resolvedVenueId,
                      table_number: tableNum,
                      seat_number: seatNum,
                      status: 'occupied',
                      player_name: playerName,
                      member_id: member.id,
                      seated_at: new Date().toISOString()
                  }, { onConflict: 'venue_id,table_number,seat_number' });
          } catch (e) {
              console.warn('Seat upsert failed (non-fatal):', e.message);
          }

          // ── 9. Log check-in ──
          try {
              await getSupabase()
                  .from('commander_checkins')
                  .insert({
                      member_id: member.id,
                      venue_id: resolvedVenueId,
                      checked_in_at: new Date().toISOString()
                  });
          } catch (e) {
              console.warn('Check-in log failed (non-fatal):', e.message);
          }

          return res.status(200).json({
              success: true,
              data: {
                  session_id: session.id,
                  player_name: playerName,
                  member_id: member.id,
                  table_number: tableNum,
                  seat_number: seatNum,
                  time_allocated_minutes: timeToAllocate,
                  venue_type: venueType,
                  membership_tier: member.membership_tier || 'standard',
                  photo_url: member.photo_url || null,
                  started_at: session.started_at
              }
          });
      } catch (err) {
          console.warn('Player scan-in error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
