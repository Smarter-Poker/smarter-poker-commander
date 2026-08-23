/**
 * Break Table API
 * POST /api/commander/tournaments/[id]/break-table
 * Dissolves a tournament table and moves all players to other tables.
 * Used by TD Tablet Table Map when a floor manager manually breaks a table.
 * Returns receipt data (Potawatomi TOURNAMENT SEAT CHANGE CARD format).
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff, guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { enqueueSeatChangeReceipts } from '../../../../src/lib/commander/printQueue';
import { rowConflict, countCollisions } from '../../../../src/lib/commander/dbErrors';
import { denyCrossVenue } from '../../../../src/lib/commander/venueScope';
import { LIVE_SEAT_STATUSES } from '../../../../src/lib/commander/tournamentSeating';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
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

    // guardStaff, not guardWriteStaff. This route only accepts POST (it 405s
    // everything else immediately below), so the GET pass-through in
    // guardWriteStaff buys nothing here - it just means _g is the BOOLEAN true
    // on a path that can still be reached if the method check is ever moved or
    // reordered. Two routes already read _g.id to attribute money
    // (rebuy/addon p_processed_by), which would silently become undefined.
    // guardStaff always returns the staff row or ends the request.
    const _g = await guardStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' } });
    }

    try {
      const { table_number, assignments } = req.body;
      if (table_number === undefined || !Array.isArray(assignments)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'table_number And assignments Array Required' }
        });
      }

      // Fetch tournament for name, buyin_amount, and venue_id
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('id, name, buyin_amount, venue_id')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
      }
      
      // Venue scope: a valid session for one room must never reach
      // another room's tournament. See src/lib/commander/venueScope.js.
      if (denyCrossVenue(res, _g, tournament)) return;

      // Fetch real venue data from both tables in parallel.
      // 2026-08-20 audit fix: this read `venues`, whose id is a UUID and which
      // holds zero rows. commander_tournaments.venue_id is an INTEGER FK to
      // poker_venues, so the comparison was a type error, the error was
      // discarded, and every printed seat-change card said "Smarter Poker"
      // with no city/state.
      const [venueRes, settingsRes] = await Promise.all([
        getSupabase().from('poker_venues').select('name, city, state, logo_url').eq('id', tournament.venue_id).maybeSingle(),
        getSupabase().from('commander_venue_settings').select('club_logo_url').eq('venue_id', tournament.venue_id).maybeSingle()
      ]);
      const venueName = venueRes.data?.name || 'Smarter Poker';
      const venueCity = venueRes.data?.city || null;
      const venueState = venueRes.data?.state || null;
      const venueLogoUrl = settingsRes.data?.club_logo_url || venueRes.data?.logo_url || null;

      // Validate all assignments have required fields
      for (const a of assignments) {
        if (!a.entry_id || a.to_table === undefined || a.to_seat === undefined) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Each Assignment Needs entry_id, to_table, to_seat' }
          });
        }
      }

      // Check for seat conflicts in assignments
      const seatKeys = new Set();
      for (const a of assignments) {
        const key = `${a.to_table}-${a.to_seat}`;
        if (seatKeys.has(key)) {
          return res.status(400).json({
            success: false,
            error: { code: 'DUPLICATE_SEAT', message: `Duplicate Assignment: Table ${a.to_table} Seat ${a.to_seat}` }
          });
        }
        seatKeys.add(key);
      }

      // Check destination seats are not already occupied (batch query - avoids N+1).
      // Entries that are themselves being moved off the broken table are not
      // conflicts. Limit raised from 100: a truncated read silently skipped
      // seats in large fields and the guard missed real conflicts.
      const movingEntryIds = new Set(assignments.map(a => a.entry_id));
      const { data: liveSeats, error: cErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, table_number, seat_number, player_name')
        .eq('tournament_id', tournamentId)
        // SEAT OCCUPANCY: LIVE_SEAT_STATUSES mirrors the uq_commander_entries_live_seat
        // index exactly. 'registered' holds a chair - omitting it made this probe
        // report a taken seat as free, and the index then raised a 23505 the floor
        // saw as a phantom "another device filled it first". 'bagged' holds none.
                .in('status', LIVE_SEAT_STATUSES);

      // A discarded error here made the guard pass on an empty result and the
      // break went on to overwrite live seats.
      if (cErr) {
        console.error('[tournaments/break-table] seat conflict read failed', {
          tournamentId, code: cErr.code, message: cErr.message, details: cErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Verify Destination Seats' } });
      }

      const conflictingSeats = liveSeats || [];

      const occupant = conflictingSeats.find(e =>
        !movingEntryIds.has(e.id) &&
        assignments.some(a => a.to_table === e.table_number && a.to_seat === e.seat_number)
      );
      if (occupant) {
        return res.status(409).json({
          success: false,
          error: { code: 'SEAT_OCCUPIED', message: `Seat ${occupant.seat_number} At Table ${occupant.table_number} Already Occupied By ${occupant.player_name}` }
        });
      }

      // Every live player on the table being broken MUST have an assignment.
      // Without this the table was released back to the pool while a player was
      // still recorded as sitting at it, and that player vanished from the map.
      // table_number arrives as JSON and may be a string; the column is INTEGER.
      const breakTableNum = Number(table_number);
      const leftBehind = conflictingSeats.filter(e =>
        e.table_number === breakTableNum && !movingEntryIds.has(e.id)
      );
      if (leftBehind.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PLAYERS_LEFT_BEHIND',
            message: `Table ${table_number} Still Has ${leftBehind.length} Unassigned Player(s): ${leftBehind.map(e => e.player_name || 'Unknown').join(', ')}`
          }
        });
      }

      // Execute all moves
      const results = [];
      const errors = [];

      for (const a of assignments) {
        const { data: entry, error: readErr } = await getSupabase()
          .from('commander_tournament_entries')
          .select('table_number, seat_number, player_name, current_chips, metadata')
          .eq('id', a.entry_id)
          .eq('tournament_id', tournamentId)
          .maybeSingle();

        if (readErr) {
          errors.push({ entry_id: a.entry_id, error: readErr.message });
          continue;
        }
        if (!entry) {
          errors.push({ entry_id: a.entry_id, error: 'Entry Not Found In This Tournament' });
          continue;
        }

        const { error: uErr } = await getSupabase()
          .from('commander_tournament_entries')
          .update({
            table_number: a.to_table,
            seat_number: a.to_seat,
            metadata: {
              ...(entry.metadata || {}),
              last_moved_at: new Date().toISOString(),
              last_moved_from: { table: entry.table_number, seat: entry.seat_number },
              move_reason: 'table_break'
            }
          })
          .eq('id', a.entry_id)
          // Scope to this tournament so a stray entry_id cannot be moved
          .eq('tournament_id', tournamentId);

        if (uErr) {
          // One player's collision must not abort the break: the remaining
          // players still need moving, and the table is deliberately NOT
          // released while any error stands (see below), so nobody is stranded.
          errors.push(rowConflict(uErr, {
            entryId: a.entry_id,
            playerName: entry.player_name,
            tableNumber: a.to_table,
            seatNumber: a.to_seat,
            action: 'Table Break'
          }));
        } else {
          results.push({
            entry_id: a.entry_id,
            player_name: entry?.player_name,
            from_table: entry?.table_number,
            from_seat: entry?.seat_number,
            to_table: a.to_table,
            to_seat: a.to_seat,
            chips: entry?.current_chips || null
          });
        }
      }

      // Release the broken table back to inactive (ONLY if all players successfully moved).
      // 2026-08-20 audit fix, matching tournamentAutoBreak.js: table_purpose was
      // left set to 'tournament', so player-unseat.js and player-scan-in.js
      // (which test `mode === 'tournament' || table_purpose === 'tournament'`)
      // kept treating a closed table as a live tournament table. game_type and
      // stakes were left stale for the same reason. The release is also scoped
      // to this tournament so a second event's identically numbered table is
      // not released along with it.
      if (errors.length === 0) {
        const { data: released, error: releaseError } = await getSupabase()
          .from('commander_tables')
          .update({
            mode: 'inactive',
            table_purpose: null,
            tournament_id: null,
            game_type: null,
            stakes: null,
            status: 'available',
            assigned_at: null,
            assigned_by: null,
          })
          .eq('venue_id', tournament.venue_id)
          .eq('tournament_id', tournamentId)
          .eq('table_number', breakTableNum)
          .select('id');

        // A zero-row update is not a PostgREST error. Without this the table
        // could stay flagged as an active tournament table silently.
        if (!releaseError && (!released || released.length === 0)) {
          console.warn('[tournaments/break-table] release matched no rows', {
            venue_id: tournament.venue_id, tournament_id: tournamentId, table_number: breakTableNum
          });
        }

        if (releaseError) {
          console.error('[tournaments/break-table] commander_tables release failed', {
            venue_id: tournament.venue_id, tournament_id: tournamentId, table_number: breakTableNum,
            code: releaseError.code, message: releaseError.message, details: releaseError.details,
          });
          errors.push({ table_number, error: releaseError.message });
        }
      }

      // Build receipt data - full venue-level identity
      const now = new Date().toISOString();
      const receipts = results.map(r => ({
        venue_name: venueName,
        venue_city: venueCity,
        venue_state: venueState,
        venue_logo_url: venueLogoUrl,
        tournament_name: tournament.name,
        buyin_amount: tournament.buyin_amount || null,
        player_name: r.player_name,
        from_table: r.from_table,
        from_seat: r.from_seat,
        to_table: r.to_table,
        to_seat: r.to_seat,
        chips: r.chips,
        timestamp: now
      }));

      // Queue the cards server-side. This endpoint is called from the TD tablet
      // table map, which historically threw the receipts array away entirely:
      // players were relocated and no card was ever printed. The queue makes the
      // floor print station the reliable place for them to come out.
      let printJobId = null;
      if (receipts.length > 0) {
        const job = await enqueueSeatChangeReceipts(getSupabase(), {
          venueId: tournament.venue_id,
          tournamentId,
          receipts,
          brokenTable: breakTableNum,
          source: 'manual_break',
          createdBy: _g?.id || null
        });
        printJobId = job?.id || null;
      }

      const collided = countCollisions(errors);

      return res.status(200).json({
        success: errors.length === 0,
        data: {
          table_broken: table_number,
          players_moved: results.length,
          players_failed: errors.length,
          seat_collisions: collided,
          moves: results,
          receipts,
          print_job_id: printJobId,
          errors: errors.length > 0 ? errors : undefined,
          message: errors.length === 0
            ? `Table ${table_number} Broken. ${results.length} Player${results.length === 1 ? '' : 's'} Moved.`
            : `Table ${table_number} Not Fully Broken. ${results.length} Moved, ${errors.length} Failed${collided > 0 ? `, ${collided} Because The Destination Seat Was Already Taken` : ''}. The Table Stays Open Until Every Player Has A Seat.`
        }
      });
    } catch (err) {
      console.warn('Break table error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
