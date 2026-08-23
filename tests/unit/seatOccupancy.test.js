/**
 * Seat occupancy vocabulary.
 *
 * The bug this pins (fixed 2026-08-22): eight separate probes asked "is anyone
 * in this chair" using ['active','seated']. The partial unique index that
 * actually enforces one-player-per-seat covers
 * ('registered','seated','active'), and production holds 52 'registered' rows
 * sitting on a table and seat against 78 'active' - rooms seat the field
 * before the clock starts.
 *
 * A probe NARROWER than the index is the worst shape available: it reports a
 * taken chair as free, the write is attempted, and the index raises 23505 - so
 * the floor is told "another device filled it first, refresh the table map"
 * when no other device did anything, and pressing the button again reproduces
 * it forever. break-table and DELETE /tables went further and released tables
 * with players still sitting at them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { LIVE_SEAT_STATUSES } from '../../src/lib/commander/tournamentSeating';

// Verbatim from the live index, 2026-08-22:
//   CREATE UNIQUE INDEX uq_commander_entries_live_seat
//     ON commander_tournament_entries (tournament_id, table_number, seat_number)
//     WHERE status = ANY (ARRAY['registered','seated','active'])
//       AND table_number IS NOT NULL AND seat_number IS NOT NULL
const INDEX_PREDICATE_STATUSES = ['registered', 'seated', 'active'];

describe('LIVE_SEAT_STATUSES', () => {
  it('matches the uq_commander_entries_live_seat predicate exactly', () => {
    expect([...LIVE_SEAT_STATUSES].sort()).toEqual([...INDEX_PREDICATE_STATUSES].sort());
  });

  it('includes registered - the one that was missing', () => {
    expect(LIVE_SEAT_STATUSES).toContain('registered');
  });

  it('excludes bagged, which holds no chair overnight', () => {
    expect(LIVE_SEAT_STATUSES).not.toContain('bagged');
  });

  it('excludes alternate, which is not in a chair until promoted', () => {
    expect(LIVE_SEAT_STATUSES).not.toContain('alternate');
  });

  it('is frozen so a caller cannot mutate the shared vocabulary', () => {
    expect(Object.isFrozen(LIVE_SEAT_STATUSES)).toBe(true);
  });
});

describe('no seating route re-declares a narrower occupancy filter', () => {
  const ROOT = join(__dirname, '..', '..');
  const API = join(ROOT, 'pages', 'api', 'tournaments');

  function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p, out);
      else if (ent.name.endsWith('.js')) out.push(p);
    }
    return out;
  }

  // Routes whose .in('status', [...]) is a FIELD count or a lifecycle filter,
  // not a seat-occupancy probe. Listed explicitly so a new seating route
  // cannot quietly join them.
  const NOT_OCCUPANCY = new Set([
    'register.js', 'entries.js', 'notify.js', 'clock.js', 'my-chips.js',
    'eliminate.js', 'restore.js', 'final-table.js', 'bag-and-tag.js',
    'resume-day.js', 'convert-waitlist.js', 'seat-conflicts.js', 'index.js',
  ]);

  it('uses the shared constant wherever it probes a chair', () => {
    const offenders = [];
    for (const file of walk(API)) {
      const name = file.split('/').pop();
      if (NOT_OCCUPANCY.has(name)) continue;
      const src = readFileSync(file, 'utf8');
      // A seat-occupancy probe reads table_number/seat_number. If such a file
      // still carries a literal status array missing 'registered', it is the
      // bug coming back.
      if (!/seat_number/.test(src)) continue;
      for (const m of src.matchAll(/\.in\(\s*['"]status['"]\s*,\s*\[([^\]]*)\]/g)) {
        const list = m[1];
        const hasSeated = /['"]seated['"]/.test(list);
        const hasActive = /['"]active['"]/.test(list);
        const hasRegistered = /['"]registered['"]/.test(list);
        if (hasSeated && hasActive && !hasRegistered) {
          offenders.push(`${name}: .in('status', [${list.trim()}])`);
        }
      }
    }
    expect(
      offenders,
      `Use LIVE_SEAT_STATUSES from src/lib/commander/tournamentSeating:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
