/**
 * Tournament Auto-Break Utility
 * Shared by clock.js (level advance) and eliminate.js (player bust)
 *
 * Rules:
 *  - Only fires AFTER the re-entry period has ended:
 *      (current_level + 1) > max(rebuy_end_level || 0, late_registration_levels || 0)
 *  - Before re-entry ends → returns null (manual breaking only)
 *  - Breaks at most ONE table per call (the smallest active table)
 *  - Seat assignments are RANDOMIZED using Fisher-Yates shuffle
 *  - Returns receipt data for Bluetooth printing on the TD tablet
 */
import { createClient } from '@supabase/supabase-js';

// Lazy getter - prevents SSG/SSR crashes when env vars aren't available at module load time.
// Missing env vars throw at FIRST USE (never at import) instead of silently
// building a client against a placeholder host that fails every query.
let _supabase;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) {
            throw new Error('[tournamentAutoBreak] Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) are required');
        }
        _supabase = createClient(url, key);
    }
    return _supabase;
}

/**
 * UNIQUE VIOLATION (Postgres 23505)
 *
 * Production carries uq_commander_entries_live_seat, a partial unique index on
 * (tournament_id, table_number, seat_number) for live statuses. A seat write
 * that lands on a chair somebody else just took is now REJECTED rather than
 * silently double-booking the table.
 *
 * The same predicate lives in src/lib/commander/dbErrors.js for every API
 * route. It is duplicated here on purpose: this module ships inside the
 * @smarter-poker/commander-shared package and must not reach across the package
 * boundary into the host app's src/ tree.
 */
function isUniqueViolation(error) {
    if (!error) return false;
    if (error.code === '23505') return true;
    const text = [error.message, error.details, error.hint, error.constraint].filter(Boolean).join(' ');
    return /duplicate key value violates unique constraint/i.test(text);
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
 * Uses the higher of rebuy_end_level or late_registration_levels.
 * (rebuy_levels was never a real column - it always read as undefined.)
 *
 * @param {object} tournament - Full tournament row
 * @param {number} currentLevel - Current 0-indexed blind level
 */
function isReEntryPeriodOver(tournament, currentLevel) {
    const reentryEnd = Math.max(
        tournament.rebuy_end_level || 0,
        tournament.late_registration_levels || 0
    );
    // If no re-entry is configured at all (0), the period never existed - still treat as "over"
    // so auto-break can work from the start.
    // current_level is 0-indexed; rebuy_end_level / late_registration_levels
    // are 1-indexed level NUMBERS (same comparison as rebuy.js / register.js).
    return (currentLevel + 1) > reentryEnd;
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
        // 2026-08-20 audit fix: this read `venues`, whose id is a UUID and which
        // holds zero rows. commander_tournaments.venue_id is an INTEGER FK to
        // poker_venues, so the comparison was a type error, the error was
        // discarded, and every auto-break receipt printed with no venue header.
        if (tournament.venue_id) {
            const { data: venueRow } = await getSupabase()
                .from('poker_venues')
                .select('name, logo_url, city, state')
                .eq('id', tournament.venue_id)
                .maybeSingle();
            venueName = venueRow?.name || venueName || '';
            venueLogoUrl = venueRow?.logo_url || null;
            venueCity = venueRow?.city || null;
            venueState = venueRow?.state || null;
        }


        const { data: tables, error: tablesErr } = await getSupabase()
            .from('commander_tables')
            .select('id, table_number, max_seats')
            .eq('venue_id', tournament.venue_id)
            .eq('tournament_id', tournamentId)
            .eq('mode', 'tournament');

        // Discarded read errors here are indistinguishable from "no tables" and
        // silently disable auto-break for the whole tournament. Surface them.
        if (tablesErr) {
            console.error('[auto-break] commander_tables read failed', {
                tournamentId, code: tablesErr.code, message: tablesErr.message, details: tablesErr.details,
            });
            return null;
        }

        if (!tables || tables.length < 2) return null; // 1 table = final table, never auto-break

        // ── Fetch active entries with seat info ──
        // SEAT OCCUPANCY. 'bagged' is deliberately excluded: a bagged player
        // (multi-day, chips in a bag overnight) holds no chair, so they must
        // not be counted into a table's occupancy and must not be "moved" by
        // a break. bag-and-tag also nulls their table/seat, so counting them
        // would only produce players with no from-seat on the receipts.
        const { data: entries, error: entriesErr } = await getSupabase()
            .from('commander_tournament_entries')
            .select('id, player_name, table_number, seat_number, current_chips')
            .eq('tournament_id', tournamentId)
            .in('status', ['active', 'seated'])
            .order('table_number')
            .order('seat_number');

        if (entriesErr) {
            console.error('[auto-break] commander_tournament_entries read failed', {
                tournamentId, code: entriesErr.code, message: entriesErr.message, details: entriesErr.details,
            });
            return null;
        }

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
            const { data: liveOccupants, error: liveErr } = await getSupabase()
                .from('commander_tournament_entries')
                .select('seat_number')
                .eq('tournament_id', tournamentId)
                .eq('table_number', t.table_number)
                // SEAT OCCUPANCY, same rule as above: bagged players hold no
                // seat, so they never make a destination chair look taken.
                .in('status', ['active', 'seated']);
            // A discarded error here made the guard treat every seat as free and
            // the break could double-seat a table. Abort instead.
            if (liveErr) {
                console.error('[auto-break] live occupancy read failed', {
                    tournamentId, table_number: t.table_number,
                    code: liveErr.code, message: liveErr.message, details: liveErr.details,
                });
                return null;
            }
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
                .eq('tournament_id', tournamentId)
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
                .eq('id', a.entry_id)
                .eq('tournament_id', tournamentId);

            if (uErr) {
                // One player's collision must NOT abort the break. The table is
                // only released when errors.length === 0 (below), so a partial
                // break leaves the table open and nobody is stranded.
                const collision = isUniqueViolation(uErr);
                errors.push({
                    entry_id: a.entry_id,
                    player_name: a.player_name,
                    code: collision ? 'SEAT_OCCUPIED' : 'DB_ERROR',
                    error: collision
                        ? `Seat ${a.to_seat} At Table ${a.to_table} Is Already Taken. Another Device Filled It First. Move ${a.player_name || 'This Player'} By Hand.`
                        : uErr.message,
                    collision
                });
            } else {
                moved.push(a);
            }
        }

        // ── Close and release the broken table (ONLY if all players moved) ──
        let tableClosed = false;
        if (errors.length === 0) {
            // NOTE: commander_tables has NO updated_at column - including it
            // makes PostgREST reject the UPDATE and the table is never released.
            // 2026-08-20: also clear table_purpose. Leaving it set to
            // 'tournament' on a released table made player-unseat.js and
            // player-scan-in.js (which test `mode === 'tournament' ||
            // table_purpose === 'tournament'`) keep treating a closed table as
            // a live tournament table.
            const { error: releaseErr } = await getSupabase()
                .from('commander_tables')
                .update({
                    mode: 'inactive',
                    table_purpose: null,
                    tournament_id: null,
                    game_type: null,
                    stakes: null,
                    status: 'available',
                    assigned_at: null,
                    assigned_by: null
                })
                .eq('venue_id', tournament.venue_id)
                .eq('tournament_id', tournamentId)
                .eq('table_number', breakCandidate.table_number);
            if (releaseErr) {
                console.warn(`[auto-break] Table ${breakCandidate.table_number} release failed:`, releaseErr.message);
            } else {
                tableClosed = true;
            }

            // Any cash-style table session rows left pointing at the broken
            // table would keep it looking occupied on the tablets.
            const { error: sessionErr } = await getSupabase()
                .from('commander_table_seats')
                .delete()
                .eq('venue_id', tournament.venue_id)
                .eq('table_number', breakCandidate.table_number);
            if (sessionErr) {
                console.warn(`[auto-break] Seat cleanup for table ${breakCandidate.table_number} failed:`, sessionErr.message);
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

        // Queue the seat-change cards server-side. The break may have been
        // triggered from a table tablet or a background level advance, neither
        // of which can open a print window, so the floor print station is the
        // only reliable place for these cards to come out.
        let printJobId = null;
        if (receipts.length > 0) {
            const { data: job, error: jobErr } = await getSupabase()
                .from('commander_print_jobs')
                .insert({
                    venue_id: tournament.venue_id,
                    tournament_id: tournamentId,
                    job_type: 'table_break',
                    status: 'queued',
                    title: `Table ${breakCandidate.table_number} Broken, ${receipts.length} Seat Change Cards`,
                    payload: { receipts, broken_table: breakCandidate.table_number },
                    receipt_count: receipts.length,
                    source: 'auto_break',
                    table_number: breakCandidate.table_number
                })
                .select('id')
                .maybeSingle();
            if (jobErr) {
                console.error('[auto-break] print job enqueue failed', {
                    tournamentId, code: jobErr.code, message: jobErr.message, details: jobErr.details
                });
            } else {
                printJobId = job?.id || null;
            }
        }

        const collided = errors.filter(e => e && e.collision === true).length;

        return {
            executed: true,
            break_table: breakCandidate.table_number,
            table_closed: tableClosed,
            players_moved: moved.length,
            players_failed: errors.length,
            seat_collisions: collided,
            moves: moved,
            receipts,
            print_job_id: printJobId,
            errors: errors.length > 0 ? errors : undefined,
            message: errors.length === 0
                ? `Table ${breakCandidate.table_number} Broken. ${moved.length} Player${moved.length === 1 ? '' : 's'} Moved.`
                : `Table ${breakCandidate.table_number} Not Fully Broken. ${moved.length} Moved, ${errors.length} Failed${collided > 0 ? `, ${collided} Because The Destination Seat Was Already Taken` : ''}. The Table Stays Open Until Every Player Has A Seat.`
        };

    } catch (err) {
        console.warn('[App] Handled exception:', err?.message || err);
        // Callers treat null as "no break occurred" - keep that contract on error.
        return null;
    }
}
