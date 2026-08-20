/**
 * Break Table API
 * POST /api/commander/tournaments/[id]/break-table
 * Dissolves a tournament table and moves all players to other tables.
 * Used by TD Tablet Table Map when a floor manager manually breaks a table.
 * Returns receipt data (Potawatomi TOURNAMENT SEAT CHANGE CARD format).
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

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
        .in('status', ['active', 'seated']);

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
          errors.push({ entry_id: a.entry_id, error: uErr.message });
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

      // Release the broken table back to inactive (ONLY if all players successfully moved)
      if (errors.length === 0) {
        const { error: releaseError } = await getSupabase()
          .from('commander_tables')
          .update({
            mode: 'inactive',
            tournament_id: null,
            status: 'available',
            assigned_at: null,
          })
          .eq('venue_id', tournament.venue_id)
          .eq('table_number', table_number);

        if (releaseError) {
          console.error('[tournaments/break-table] commander_tables release failed', {
            venue_id: tournament.venue_id, table_number,
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

      return res.status(200).json({
        success: errors.length === 0,
        data: {
          table_broken: table_number,
          players_moved: results.length,
          moves: results,
          receipts,
          errors: errors.length > 0 ? errors : undefined
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
