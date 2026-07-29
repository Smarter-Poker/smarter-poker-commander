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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { id: tournamentId } = req.query;
    if (!tournamentId) {
      return res.status(400).json({ success: false, error: 'Tournament ID required' });
    }

    try {
      const { table_number, assignments } = req.body;
      if (table_number === undefined || !Array.isArray(assignments)) {
        return res.status(400).json({
          success: false,
          error: 'table_number and assignments array required'
        });
      }

      // Fetch tournament for name, buyin_amount, and venue_id
      const { data: tournament, error: tErr } = await getSupabase()
        .from('commander_tournaments')
        .select('id, name, buyin_amount, venue_id')
        .eq('id', tournamentId)
        .maybeSingle();
      if (tErr || !tournament) {
        return res.status(404).json({ success: false, error: 'Tournament not found' });
      }

      // Fetch real venue data from both tables in parallel
      const [venueRes, settingsRes] = await Promise.all([
        getSupabase().from('venues').select('name, city, state').eq('id', tournament.venue_id).maybeSingle(),
        getSupabase().from('commander_venue_settings').select('club_logo_url').eq('venue_id', tournament.venue_id).maybeSingle()
      ]);
      const venueName = venueRes.data?.name || 'Smarter Poker';
      const venueCity = venueRes.data?.city || null;
      const venueState = venueRes.data?.state || null;
      const venueLogoUrl = settingsRes.data?.club_logo_url || null;

      // Validate all assignments have required fields
      for (const a of assignments) {
        if (!a.entry_id || a.to_table === undefined || a.to_seat === undefined) {
          return res.status(400).json({
            success: false,
            error: 'Each assignment needs entry_id, to_table, to_seat'
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
            error: `Duplicate assignment: Table ${a.to_table} Seat ${a.to_seat}`
          });
        }
        seatKeys.add(key);
      }

      // Check destination seats are not already occupied (batch query — avoids N+1)
      const destPairs = assignments.map(a => `(${a.to_table},${a.to_seat})`);
      const { data: conflictingSeats } = await getSupabase()
        .from('commander_tournament_entries')
        .select('table_number, seat_number, player_name')
        .eq('tournament_id', tournamentId)
        .in('status', ['active', 'seated'])
            .limit(100);

      const occupiedSet = new Set(
        (conflictingSeats || [])
          .filter(e => assignments.some(a => a.to_table === e.table_number && a.to_seat === e.seat_number))
      );
      for (const e of occupiedSet) {
        return res.status(409).json({
          success: false,
          error: `Seat ${e.seat_number} at Table ${e.table_number} already occupied by ${e.player_name}`
        });
      }

      // Execute all moves
      const results = [];
      const errors = [];

      for (const a of assignments) {
        const { data: entry } = await getSupabase()
          .from('commander_tournament_entries')
          .select('table_number, seat_number, player_name, current_chips, metadata')
          .eq('id', a.entry_id)
          .maybeSingle();

        const { error: uErr } = await getSupabase()
          .from('commander_tournament_entries')
          .update({
            table_number: a.to_table,
            seat_number: a.to_seat,
            metadata: {
              ...(entry?.metadata || {}),
              last_moved_at: new Date().toISOString(),
              last_moved_from: { table: entry?.table_number, seat: entry?.seat_number },
              move_reason: 'table_break'
            }
          })
          .eq('id', a.entry_id);

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
        await getSupabase()
          .from('commander_tables')
          .update({
            mode: 'inactive',
            tournament_id: null,
            status: 'available',
            assigned_at: null,
          })
          .eq('venue_id', tournament.venue_id)
          .eq('table_number', table_number);
      } else {
      }

      // Build receipt data — full venue-level identity
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
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
