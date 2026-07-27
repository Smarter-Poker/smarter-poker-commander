/**
 * Tournament Auto-Break Utility
 * Shared by clock.js (level advance) and eliminate.js (player bust)
 *
 * Rules:
 *  - Only fires AFTER the re-entry period has ended:
 *      current_level > max(rebuy_levels || 0, late_registration_levels || 0)
 *  - Before re-entry ends → returns null (manual breaking only)
 *  - Breaks at most ONE table per call (the smallest active table)
 *  - Seat assignments are RANDOMIZED using Fisher-Yates shuffle
 *  - Returns receipt data for Bluetooth printing on the TD tablet
 */
import { createClient } from '@supabase/supabase-js';

// Lazy getter — prevents SSG/SSR crashes when env vars aren't available at module load time.
let _supabase;
function getSupabase() {
    if (!_supabase) {
        _supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
        );
    }
    return _supabase;
}

/**
 * Fisher-Yates random shuffle (in-place)
 */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Returns true if re-entry/rebuy period has ended.
 * Uses the higher of rebuy_levels or late_registration_levels.
 *
 * @param {object} tournament - Full tournament row
 * @param {number} currentLevel - Current 0-indexed blind level
 */
function isReEntryPeriodOver(tournament, currentLevel) {
    const reentryEnd = Math.max(
        tournament.rebuy_levels || 0,
        tournament.late_registration_levels || 0
    );
    // If no re-entry is configured at all (0), the period never existed — still treat as "over"
    // so auto-break can work from the start.
    return currentLevel > reentryEnd;
}

/**
 * Checks if a table can be broken and, if so, executes it.
 * Safe to call after every level advance or player elimination.
 *
 * @param {string} tournamentId
 * @param {object} tournament - Full tournament row (must have current_level, venue_id, rebuy_levels, etc.)
 * @returns {object|null} auto-break result with receipt data, or null if no break occurred
 */
export async function checkAndExecuteAutoBreak(tournamentId, tournament) {
    try {
        const currentLevel = tournament.current_level || 0;

        // GATE 1: Re-entry period must be over. If not, return null (manual only).
        if (!isReEntryPeriodOver(tournament, currentLevel)) {
            return null;
        }

        // GATE 2: Tournament must be active
        if (!['running', 'paused', 'final_table', 'hand_for_hand'].includes(tournament.status)) {
            return null;
        }

        // ── Look up venue name + logo for receipt header ──
        let venueName = tournament.venue_name || '';
        let venueLogoUrl = null;
        let venueCity = null;
        let venueState = null;
        if ((!venueName || !venueLogoUrl) && tournament.venue_id) {
            const { data: venueRow } = await getSupabase()
                .from('venues')
                .select('name, logo_url, city, state')
                .eq('id', tournament.venue_id)
                .maybeSingle();
            venueName = venueRow?.name || venueName || '';
            venueLogoUrl = venueRow?.logo_url || null;
            venueCity = venueRow?.city || null;
            venueState = venueRow?.state || null;
        }


        const { data: tables } = await getSupabase()
            .from('commander_tables')
            .select('id, table_number, max_seats')
            .eq('venue_id', tournament.venue_id)
            .eq('tournament_id', tournamentId)
            .eq('mode', 'tournament');

        if (!tables || tables.length < 2) return null; // 1 table = final table, never auto-break

        // ── Fetch active entries with seat info ──
        const { data: entries } = await getSupabase()
            .from('commander_tournament_entries')
            .select('id, player_name, table_number, seat_number, current_chips')
            .eq('tournament_id', tournamentId)
            .in('status', ['active', 'seated'])
            .order('table_number')
            .order('seat_number');

        if (!entries || entries.length === 0) return null;

        // ── Build table occupancy map ──
        const tableMap = {};
        for (const t of tables) {
            tableMap[t.table_number] = { ...t, players: [], open_seats: [] };
        }
        for (const e of entries) {
            if (tableMap[e.table_number]) {
                tableMap[e.table_number].players.push(e);
            }
        }
        for (const tNum of Object.keys(tableMap || {})) {
            const t = tableMap[tNum];
            const occupied = new Set(t.players.map(p => p.seat_number));
            for (let s = 1; s <= t.max_seats; s++) {
                if (!occupied.has(s)) t.open_seats.push(s);
            }
        }

        // ── Find the smallest active table (break candidate) ──
        const tableStats = Object.values(tableMap || {})
            .filter(t => t.players.length > 0)
            .sort((a, b) => a.players.length - b.players.length);

        if (tableStats.length < 2) return null; // Can't break the last table

        const breakCandidate = tableStats[0];
        const otherTables = tableStats.filter(t => t.table_number !== breakCandidate.table_number);

        // Count open seats on other tables
        const totalOpenSeats = otherTables.reduce((sum, t) => sum + t.open_seats.length, 0);
        const playersToMove = breakCandidate.players.length;

        if (totalOpenSeats < playersToMove) return null; // Not enough room yet

        // ── Conflict guard: Re-validate destination seats are still empty right now ──
        // (Guards against a race condition where another TD action occupies a seat
        //  between our read and our write)
        for (const t of otherTables) {
            if (t.open_seats.length === 0) continue;
            const { data: liveOccupants } = await getSupabase()
                .from('commander_tournament_entries')
                .select('seat_number')
                .eq('tournament_id', tournamentId)
                .eq('table_number', t.table_number)
                .in('status', ['active', 'seated']);
            const liveOccupied = new Set((liveOccupants || []).map(x => x.seat_number));
            // Remove any seat that became occupied since our initial read
            t.open_seats = t.open_seats.filter(s => !liveOccupied.has(s));
        }

        // Re-check total open seats after live validation
        const verifiedOpenSeats = otherTables.reduce((sum, t) => sum + t.open_seats.length, 0);
        if (verifiedOpenSeats < playersToMove) {
            console.warn(`[auto-break] Race condition detected: seats became occupied. Aborting auto-break.`);
            return null;
        }

        // ── Build RANDOMIZED seat assignments ──
        // Shuffle the destination tables' open seats to ensure random placement
        const shuffledPlayers = shuffleArray([...breakCandidate.players]);

        // Collect all available seats from destination tables (shuffled)
        const availableSlots = [];
        for (const t of otherTables) {
            const shuffledSeats = shuffleArray([...t.open_seats]);
            for (const seat of shuffledSeats) {
                availableSlots.push({ table_number: t.table_number, seat_number: seat });
            }
        }
        // Shuffle the slot order one final time for full randomness
        shuffleArray(availableSlots);

        const assignments = shuffledPlayers.map((player, idx) => ({
            entry_id: player.id,
            player_name: player.player_name,
            from_table: player.table_number,
            from_seat: player.seat_number,
            to_table: availableSlots[idx].table_number,
            to_seat: availableSlots[idx].seat_number,
            chips: player.current_chips
        }));

        // ── Execute all moves (metadata-safe) ──
        const moved = [];
        const errors = [];

        for (const a of assignments) {
            // Fetch current metadata to preserve it
            const { data: currentEntry } = await getSupabase()
                .from('commander_tournament_entries')
                .select('metadata')
                .eq('id', a.entry_id)
                .maybeSingle();

            const { error: uErr } = await getSupabase()
                .from('commander_tournament_entries')
                .update({
                    table_number: a.to_table,
                    seat_number: a.to_seat,
                    metadata: {
                        ...(currentEntry?.metadata || {}),
                        last_moved_at: new Date().toISOString(),
                        last_moved_from: { table: a.from_table, seat: a.from_seat },
                        move_reason: 'auto_table_break'
                    }
                })
                .eq('id', a.entry_id);

            if (uErr) {
                errors.push({ entry_id: a.entry_id, error: uErr.message });
            } else {
                moved.push(a);
            }
        }

        // ── Release the broken table (ONLY if all players successfully moved) ──
        if (errors.length === 0) {
            const { error: releaseErr } = await getSupabase()
                .from('commander_tables')
                .update({
                    mode: 'inactive',
                    tournament_id: null,
                    status: 'available',
                    assigned_at: null,
                    updated_at: new Date().toISOString()
                })
                .eq('venue_id', tournament.venue_id)
                .eq('tournament_id', tournamentId)
                .eq('table_number', breakCandidate.table_number);
            if (releaseErr) {
                console.warn(`[auto-break] Table ${breakCandidate.table_number} release failed:`, releaseErr.message);
            }
        } else {
            console.warn(`[auto-break] Table ${breakCandidate.table_number} not released because ${errors.length} player moves failed.`);
        }

        // ── Build receipt data for Bluetooth printer ──
        const receipts = moved.map(a => ({
            venue_name: venueName,
            venue_logo_url: venueLogoUrl,
            venue_city: venueCity,
            venue_state: venueState,
            tournament_name: tournament.name,
            buyin_amount: tournament.buyin_amount || null,
            player_name: a.player_name,
            from_table: a.from_table,
            from_seat: a.from_seat,
            to_table: a.to_table,
            to_seat: a.to_seat,
            chips: a.chips,
            timestamp: new Date().toISOString()
        }));

        console.info(`[auto-break] Table ${breakCandidate.table_number} auto-broken: ${moved.length} players moved (level ${currentLevel})`);

        return {
            executed: true,
            break_table: breakCandidate.table_number,
            players_moved: moved.length,
            moves: moved,
            receipts,
            errors: errors.length > 0 ? errors : undefined
        };

    } catch (err) { console.warn('[App] Handled exception:', err?.message || err); }
}
