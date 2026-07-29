-- Migration: align commander_shift_handoffs.venue_id type with the rest of Commander
-- Date: 2026-07-29
-- Tier-3 change (ALTER COLUMN TYPE). DO NOT auto-apply — review + operator action required.
--
-- WHY
-- ---
-- commander_shift_handoffs.venue_id is currently `uuid`. Every sibling Commander
-- table uses an integer-family venue_id:
--   commander_tables.venue_id                 integer
--   commander_waitlist.venue_id               integer
--   commander_incidents.venue_id              integer
--   commander_games.venue_id                  integer
--   commander_dealers.venue_id                integer
--   commander_promotions.venue_id             integer
--   commander_tournaments.venue_id            integer
--   commander_escrow_transactions.venue_id    integer
--   commander_table_sessions.venue_id         bigint   (outlier)
-- and the canonical key poker_venues.id is `integer`.
--
-- pages/api/shift-handoff.js (createHandoff) snapshots the current floor by
-- querying commander_tables / commander_waitlist / commander_incidents /
-- commander_games with `.eq('venue_id', venue_id)` (integer columns) and then
-- inserts that SAME venue_id into commander_shift_handoffs.venue_id (uuid).
-- When venue_id arrives as an integer — as every sibling table implies it must —
-- the INSERT fails on the uuid column and shift-handoff is broken.
--
-- Target type: integer, to match poker_venues.id and the majority of siblings.
--
-- EXISTING DATA — CONVERSION IS UNSAFE AS-IS
-- -----------------------------------------
-- As of 2026-07-29 the table has 10 rows, and ALL 10 hold the single uuid
-- venue_id '005cddc8-ecd9-4cd9-aca1-b809609d1239', which is NOT integer-castable.
-- The ALTER below will ABORT on that data. Before running, an operator MUST
-- either (a) remap those rows to the correct integer poker_venues.id, or
-- (b) delete them if they are test/junk rows. Do not force this migration
-- without resolving those 10 rows first.

BEGIN;

-- Pre-flight assertion: refuse to run while any non-integer-castable venue_id
-- remains, so the operator gets a clear error instead of a partial change.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM public.commander_shift_handoffs
  WHERE venue_id IS NOT NULL
    AND venue_id::text !~ '^[0-9]+$';
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'commander_shift_handoffs has % row(s) with non-integer venue_id; remap or delete them before running this migration', bad_count;
  END IF;
END $$;

ALTER TABLE public.commander_shift_handoffs
  ALTER COLUMN venue_id TYPE integer
  USING venue_id::text::integer;

COMMIT;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- BEGIN;
-- ALTER TABLE public.commander_shift_handoffs
--   ALTER COLUMN venue_id TYPE uuid
--   USING venue_id::text::uuid;
-- COMMIT;
--
-- CAUTION: integer venue_id values written after this migration are NOT
-- uuid-castable, so the rollback above only succeeds if no new integer rows
-- exist. If integer rows have been written, roll back by restoring from a
-- pre-migration backup instead.
