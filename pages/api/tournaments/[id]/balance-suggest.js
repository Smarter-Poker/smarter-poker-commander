/**
 * Balance Suggest API
 * GET /api/commander/tournaments/[id]/balance-suggest
 * Returns suggested player moves to balance tournament tables
 * Algorithm: break table with fewest players if possible, otherwise move from fullest to emptiest
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

function findAvailableSeat(maxSeats, occupiedSeats) {
  for (let s = 1; s <= maxSeats; s++) {
    if (!occupiedSeats.includes(s)) return s;
  }
  return null;
}

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) {
      return res.status(400).json({ success: false, error: 'Tournament ID required' });
    }

    try {
      // Staff is already validated by guardWriteStaff at the handler level

      // Get tournament for venue_id
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('id, venue_id')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });

      // Get all active entries with table/seat info
      const { data: entries } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_name, table_number, seat_number, status, current_chips, metadata')
        .eq('tournament_id', tournamentId)
        .in('status', ['active', 'seated']);

      if (!entries || entries.length === 0) {
        return res.status(200).json({ success: true, data: { type: 'none', moves: [], message: 'No active players' } });
      }

      // Get unique table numbers from entries
      // 2026-07-25 audit fix: .limit() is a query-builder method, not an Array
      // method — calling it on this array threw a TypeError.
      const tableNumbers = [...new Set(entries.map(e => e.table_number).filter(Boolean))];
      if (tableNumbers.length < 2) {
        return res.status(200).json({ success: true, data: { type: 'none', moves: [], message: 'Only one table active' } });
      }

      // Get table configs
      const { data: tables } = await getSupabase()
        .from('commander_tables')
        .select('id, table_number, max_seats, status')
        .eq('venue_id', tournament.venue_id)
        .in('table_number', tableNumbers)
            .limit(100)

      const maxSeats = tables?.[0]?.max_seats || 9;

      // Count players per table
      const tableCounts = {};
      tableNumbers.forEach(tn => { tableCounts[tn] = 0; });
      entries.forEach(e => {
        if (e.table_number) tableCounts[e.table_number] = (tableCounts[e.table_number] || 0) + 1;
      });

      const totalPlayers = entries.length;
      const minTablesNeeded = Math.ceil(totalPlayers / maxSeats);
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
          while (destIdx < otherCounts.length && otherCounts[destIdx].count >= maxSeats) destIdx++;
          if (destIdx >= otherCounts.length) destIdx = 0;

          const targetTable = otherCounts[destIdx].tn;
          const occupied = entries
            .filter(e => e.table_number === targetTable)
            .map(e => e.seat_number)
            .concat(assignedSeats[targetTable] || []);

          const seat = findAvailableSeat(maxSeats, occupied);
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
            message: `Break Table ${tableToBreak} — move ${playersToMove.length} players`
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
          const seat = findAvailableSeat(maxSeats, occupied);

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
              ? `Move ${moves[0].player_name} from Table ${fromTable} to Table ${toTable}`
              : 'No valid moves found'
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: { type: 'none', moves: [], table_counts: tableCounts, message: 'Tables are balanced' }
      });

    } catch (err) {
      console.warn('Balance suggest error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
