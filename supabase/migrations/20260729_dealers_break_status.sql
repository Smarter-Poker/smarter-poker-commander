-- Dealer break/return status for commander_dealers
--
-- pages/api/dealers/rotations.js:
--   action === 'break'  -> UPDATE commander_dealers SET current_status='on_break',  break_started_at=now()
--   action === 'return' -> UPDATE commander_dealers SET current_status='available', break_started_at=null
--
-- commander_dealers real columns today: id, venue_id, user_id, name, employee_id,
-- skill_level, certified_games, is_active, hired_date, created_at.
-- It has NEITHER current_status NOR break_started_at, so both writes fail with
-- PGRST204 and dealer break/return is broken in production.
--
-- The application code already matches the intended columns, so the fix is a
-- schema change (not a code change): add the two columns the code expects.

ALTER TABLE public.commander_dealers
  ADD COLUMN IF NOT EXISTS current_status text DEFAULT 'available';

ALTER TABLE public.commander_dealers
  ADD COLUMN IF NOT EXISTS break_started_at timestamptz;
