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

  const open = await findOpenSeat(supabase, tournament);
  if (!open) return null;

  const { data: promoted, error } = await supabase
    .from('commander_tournament_entries')
    .update({
      status: 'seated',
      table_number: open.table_number,
      seat_number: open.seat_number,
      current_chips: tournament.starting_chips || 0
    })
    .eq('id', next.id)
    .eq('status', 'alternate')
    .select()
    .maybeSingle();

  if (error || !promoted) return null;
  return promoted;
}
