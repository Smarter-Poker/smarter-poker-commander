/**
 * Balance Suggest API
 * GET /api/commander/tournaments/[id]/balance-suggest
 * Returns suggested player moves to balance tournament tables
 * Algorithm: break table with fewest players if possible, otherwise move from fullest to emptiest
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
// 2026-08-20 security fix: this route is GET-only and returns player names,
// table numbers and seat positions. guardWriteStaff passes GET through
// WITHOUT checking anything (its own docstring says so), so the whole seating
// map of any live tournament was readable by anyone holding the id. guardStaff
// requires a verified staff session on every method.
import { guardStaff } from '../../../../src/lib/commander/auth';
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

function findAvailableSeat(maxSeats, occupiedSeats) {
  for (let s = 1; s <= maxSeats; s++) {
    if (!occupiedSeats.includes(s)) return s;
  }
  return null;
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const _g = await guardStaff(req, res); if (!_g) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tournament ID Required' } });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament for venue_id
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });

      // Get all active entries with table/seat info
      const { data: entries, error: eErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_name, table_number, seat_number, status, current_chips, metadata')
        .eq('tournament_id', tournamentId)
        // SEAT OCCUPANCY: balancing moves people between chairs, and a
        // 'bagged' player is not in one. Excluded on purpose.
        .in('status', ['active', 'seated']);

      // A discarded read error here used to look identical to "no players" and
      // the TD was told the tables were balanced when nothing had been read.
      if (eErr) {
        console.error('[tournaments/balance-suggest] entries read failed', {
          tournamentId, code: eErr.code, message: eErr.message, details: eErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Read Tournament Entries' } });
      }

      if (!entries || entries.length === 0) {
        return res.status(200).json({ success: true, data: { type: 'none', moves: [], message: 'No Active Players' } });
      }

      // Get unique table numbers from entries
      // 2026-07-25 audit fix: .limit() is a query-builder method, not an Array
      // method - calling it on this array threw a TypeError.
      const tableNumbers = [...new Set(entries.map(e => e.table_number).filter(Boolean))];
      if (tableNumbers.length < 2) {
        return res.status(200).json({ success: true, data: { type: 'none', moves: [], message: 'Only One Table Active' } });
      }

      // Get table configs
      const { data: tables, error: tblErr } = await getSupabase()
        .from('commander_tables')
        .select('id, table_number, max_seats, status')
        .eq('venue_id', tournament.venue_id)
        .in('table_number', tableNumbers)
        .limit(200);

      if (tblErr) {
        console.error('[tournaments/balance-suggest] commander_tables read failed', {
          venue_id: tournament.venue_id, code: tblErr.code, message: tblErr.message, details: tblErr.details,
        });
        return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Read Table Configuration' } });
      }

      // Seat capacity is PER TABLE. Reading tables[0].max_seats and applying it
      // to every table suggested seat 9 on an 8-handed table (and hid the real
      // open seat on a 10-handed one) whenever a room mixes table sizes.
      const seatsByTable = {};
      for (const t of (tables || [])) {
        if (t && t.table_number != null) seatsByTable[t.table_number] = t.max_seats || 9;
      }
      const maxSeatsFor = (tn) => seatsByTable[tn] || 9;
      // Conservative denominator for "can the field fit on fewer tables" - the
      // SMALLEST table capacity, so a break is never suggested that will not fit.
      const capacities = Object.values(seatsByTable).map(Number).filter(Number.isFinite);
      const minTableCapacity = capacities.length > 0 ? Math.min(...capacities) : 9;

      // Count players per table
      const tableCounts = {};
      tableNumbers.forEach(tn => { tableCounts[tn] = 0; });
      entries.forEach(e => {
        if (e.table_number) tableCounts[e.table_number] = (tableCounts[e.table_number] || 0) + 1;
      });

      const totalPlayers = entries.length;
      const minTablesNeeded = Math.ceil(totalPlayers / minTableCapacity);
      const moves = [];

      // --- CAN WE BREAK A TABLE? ---
      if (tableNumbers.length > minTablesNeeded) {
        const sorted = Object.entries(tableCounts || {}).sort((a, b) => a[1] - b[1]);
        const tableToBreak = parseInt(sorted[0][0]);
        const playersToMove = entries
          .filter(e => e.table_number === tableToBreak)
          .sort((a, b) => (a.seat_number || 0) - (b.seat_number || 0));

        const otherCounts = sorted.slice(1)
          .map(([tn, count]) => ({ tn: parseInt(tn), count }))
          .sort((a, b) => a.count - b.count);

        let destIdx = 0;
        const assignedSeats = {}; // track seats we're assigning in this batch

        for (const player of playersToMove) {
          while (destIdx < otherCounts.length && otherCounts[destIdx].count >= maxSeatsFor(otherCounts[destIdx].tn)) destIdx++;
          if (destIdx >= otherCounts.length) destIdx = 0;

          const targetTable = otherCounts[destIdx].tn;
          const occupied = entries
            .filter(e => e.table_number === targetTable)
            .map(e => e.seat_number)
            .concat(assignedSeats[targetTable] || []);

          const seat = findAvailableSeat(maxSeatsFor(targetTable), occupied);
          if (seat) {
            moves.push({
              entry_id: player.id,
              player_name: player.player_name,
              from_table: player.table_number,
              from_seat: player.seat_number,
              to_table: targetTable,
              to_seat: seat,
              reason: 'table_break'
            });
            if (!assignedSeats[targetTable]) assignedSeats[targetTable] = [];
            assignedSeats[targetTable].push(seat);
            otherCounts[destIdx].count++;
          }
        }

        return res.status(200).json({
          success: true,
          data: {
            type: 'break',
            table_to_break: tableToBreak,
            moves,
            table_counts: tableCounts,
            message: `Break Table ${tableToBreak}, Move ${playersToMove.length} Players`
          }
        });
      }

      // --- BALANCE (move from fullest to emptiest) ---
      const sorted = Object.entries(tableCounts || {}).sort((a, b) => b[1] - a[1]);
      const maxCount = sorted[0][1];
      const minCount = sorted[sorted.length - 1][1];

      if (maxCount - minCount >= 2) {
        const fromTable = parseInt(sorted[0][0]);
        const toTable = parseInt(sorted[sorted.length - 1][0]);

        // Pick unlocked player from fullest table
        const candidates = entries.filter(e =>
          e.table_number === fromTable && !e.metadata?.locked_seat
        );
        const playerToMove = candidates.length > 0
          ? candidates[Math.floor(Math.random() * candidates.length)]
          : entries.find(e => e.table_number === fromTable);

        if (playerToMove) {
          const occupied = entries
            .filter(e => e.table_number === toTable)
            .map(e => e.seat_number);
          const seat = findAvailableSeat(maxSeatsFor(toTable), occupied);

          if (seat) {
            moves.push({
              entry_id: playerToMove.id,
              player_name: playerToMove.player_name,
              from_table: fromTable,
              from_seat: playerToMove.seat_number,
              to_table: toTable,
              to_seat: seat,
              reason: 'balance'
            });
          }
        }

        return res.status(200).json({
          success: true,
          data: {
            type: 'balance',
            moves,
            table_counts: tableCounts,
            message: moves.length > 0
              ? `Move ${moves[0].player_name} From Table ${fromTable} To Table ${toTable}`
              : 'No Valid Moves Found'
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: { type: 'none', moves: [], table_counts: tableCounts, message: 'Tables Are Balanced' }
      });

    } catch (err) {
      console.warn('Balance suggest error:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}
