/**
 * Tournament Seating Helpers
 *
 * REMOVED 2026-08-22: findOpenSeat(supabase, tournament). It was exported,
 * imported by nothing, and a non-atomic JS re-implementation of what
 * commander_claim_open_seat already does in one statement. Dead code that
 * looks usable is a trap: the next reader wires it up and gets the
 * read-then-write pattern that put duplicate seat assignments into production
 * in the first place. Use claimOpenSeat().
 *
 * promoteNextAlternate(supabase, tournament, options):
 *   Seats the longest-waiting alternate into an open seat. Returns the
 *   promoted entry (with table/seat) or null when there is no alternate or
 *   no open seat. Used by eliminate.js to auto-fill a freed seat while
 *   registration is still open, TableCaptain-waitlist style.
 */

/**
 * Entry statuses that HOLD A CHAIR.
 *
 * This is not a judgement call - it is a mirror of the database. The partial
 * unique index that actually enforces one-player-per-seat is:
 *
 *   uq_commander_entries_live_seat ON (tournament_id, table_number, seat_number)
 *     WHERE status IN ('registered','seated','active')
 *       AND table_number IS NOT NULL AND seat_number IS NOT NULL
 *
 * and commander_claim_open_seat counts the same three. Any occupancy probe in
 * JS that uses a NARROWER set disagrees with the constraint that will actually
 * fire, which produces the worst possible failure: the probe says the chair is
 * free, the write is attempted, and the index raises 23505 - so the floor is
 * told "another device filled it first, refresh the table map" when no other
 * device did anything, and pressing the button again reproduces it forever.
 *
 * 'registered' is the one that kept being left out, and it is not an edge
 * case: production holds 52 'registered' rows sitting on a table and seat
 * against 78 'active' ones. Rooms seat their field before the clock starts.
 *
 * 'bagged' is deliberately EXCLUDED and that part was always right: a bagged
 * multi-day player holds no chair overnight, and counting them would make the
 * floor look full until the next day began.
 */
export const LIVE_SEAT_STATUSES = Object.freeze(['registered', 'seated', 'active']);

/**
 * claimOpenSeat(supabase, tournamentId, entryId, expectedStatus)
 *   Atomically finds AND claims the best open seat for an entry via the
 *   commander_claim_open_seat RPC, which locks the tournament row so two
 *   concurrent callers cannot be handed the same seat. Returns
 *   { table_number, seat_number } or null when the floor is full (or the
 *   entry no longer has expectedStatus).
 *
 *   Prefer this over any read-then-write seat search: that pattern is what
 *   put duplicate seat assignments into production.
 *
 *   The RPC's table pool now filters `ct.status IS DISTINCT FROM 'maintenance'`
 *   (migration commander_claim_open_seat_maintenance_filter), matching
 *   seat-draw.js, so the atomic path and the JS paths agree
 *   about which tables are seatable. It also counts 'registered' entries as
 *   occupying a chair: a player seated before the clock starts keeps that
 *   status, and production had 52 such entries holding real seats.
 */
export async function claimOpenSeat(supabase, tournamentId, entryId, expectedStatus = null) {
  const { data, error } = await supabase.rpc('commander_claim_open_seat', {
    p_entry_id: entryId,
    p_tournament_id: tournamentId,
    p_expected_status: expectedStatus
  });
  if (error) {
    console.warn('[tournamentSeating] claimOpenSeat failed:', error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.table_number == null || row.seat_number == null) return null;
  return { table_number: row.table_number, seat_number: row.seat_number };
}

export async function promoteNextAlternate(supabase, tournament) {
  const { data: alternates } = await supabase
    .from('commander_tournament_entries')
    .select('id, player_id, player_name, registered_at, created_at')
    .eq('tournament_id', tournament.id)
    .eq('status', 'alternate')
    .order('registered_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1);

  const next = alternates && alternates[0];
  if (!next) return null;

  // Atomic claim: status is checked and the seat is taken in one statement,
  // so a second promotion racing this one gets a different seat (or nothing).
  const seat = await claimOpenSeat(supabase, tournament.id, next.id, 'alternate');
  if (!seat) return null;

  const { data: promoted } = await supabase
    .from('commander_tournament_entries')
    .select()
    .eq('id', next.id)
    .maybeSingle();

  return promoted || null;
}
