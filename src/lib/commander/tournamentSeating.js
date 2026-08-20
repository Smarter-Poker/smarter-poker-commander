/**
 * Tournament Seating Helpers
 *
 * findOpenSeat(supabase, tournament):
 *   Returns { table_number, seat_number } for the first open seat on the
 *   least-occupied active table for this tournament, or null when the floor
 *   is full (or no tables are assigned yet).
 *
 * promoteNextAlternate(supabase, tournament, options):
 *   Seats the longest-waiting alternate into an open seat. Returns the
 *   promoted entry (with table/seat) or null when there is no alternate or
 *   no open seat. Used by eliminate.js to auto-fill a freed seat while
 *   registration is still open, TableCaptain-waitlist style.
 */

export async function findOpenSeat(supabase, tournament) {
  const tournamentId = tournament.id;

  const [{ data: tables }, { data: seatedEntries }] = await Promise.all([
    supabase
      .from('commander_tables')
      .select('table_number, max_seats')
      .eq('venue_id', tournament.venue_id)
      .eq('tournament_id', tournamentId)
      .neq('status', 'closed')
      .limit(200),
    supabase
      .from('commander_tournament_entries')
      .select('table_number, seat_number')
      .eq('tournament_id', tournamentId)
      // SEAT OCCUPANCY. 'bagged' excluded on purpose: a bagged player holds no
      // chair, so their old seat must be offered to the next player. Counting
      // them here would make findOpenSeat report a full floor overnight.
      .in('status', ['seated', 'active'])
      .limit(5000)
  ]);

  const seated = seatedEntries || [];

  // Table pool: assigned commander_tables, or fall back to the tables players
  // are already seated at (covers rooms that seat without table assignment rows).
  let pool = (tables || []).map(t => ({ table_number: t.table_number, max_seats: t.max_seats || 9 }));
  if (pool.length === 0) {
    const seenNumbers = [...new Set(seated.map(e => e.table_number).filter(Boolean))];
    pool = seenNumbers.map(n => ({ table_number: n, max_seats: 9 }));
  }
  if (pool.length === 0) return null;

  const occupied = new Set(seated.filter(e => e.table_number && e.seat_number)
    .map(e => `${e.table_number}:${e.seat_number}`));
  const occupancy = new Map(pool.map(t => [t.table_number, 0]));
  for (const e of seated) {
    if (occupancy.has(e.table_number)) occupancy.set(e.table_number, occupancy.get(e.table_number) + 1);
  }

  // Least-occupied table first, then lowest open seat number on it.
  const ordered = [...pool].sort((a, b) =>
    (occupancy.get(a.table_number) || 0) - (occupancy.get(b.table_number) || 0) ||
    a.table_number - b.table_number
  );
  for (const t of ordered) {
    for (let s = 1; s <= t.max_seats; s++) {
      if (!occupied.has(`${t.table_number}:${s}`)) {
        return { table_number: t.table_number, seat_number: s };
      }
    }
  }
  return null;
}

/**
 * claimOpenSeat(supabase, tournamentId, entryId, expectedStatus)
 *   Atomically finds AND claims the best open seat for an entry via the
 *   commander_claim_open_seat RPC, which locks the tournament row so two
 *   concurrent callers cannot be handed the same seat. Returns
 *   { table_number, seat_number } or null when the floor is full (or the
 *   entry no longer has expectedStatus).
 *
 *   Prefer this over findOpenSeat + a separate update: the read-then-write
 *   pattern is what put duplicate seat assignments into production.
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
