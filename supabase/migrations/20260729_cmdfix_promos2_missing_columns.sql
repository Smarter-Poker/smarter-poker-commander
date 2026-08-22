-- 2026-07-29 schema wiring fix
-- Cluster: promotions / high-hands / responsible-gaming / notifications
--
-- These endpoints write columns that do not exist on the live tables, so the
-- affected inserts/updates/selects fail with PGRST204 / 42703. Each block adds
-- the column the code depends on. "Add column" was chosen over silently
-- remapping to a differently-named existing column (which would change the
-- API/client contract) — see the PR description for the alternatives.
-- All statements are idempotent.

-- 1) commander_high_hands
--    pages/api/high-hands/index.js (createHighHand insert) and
--    pages/api/high-hands/[id].js (updateHighHand) write player_name (walk-in
--    player with no profile row — mirrors commander_promotion_awards.player_name
--    and commander_player_sessions.player_name) and table_number (human table
--    number; distinct from the existing table_id uuid FK).
ALTER TABLE public.commander_high_hands
  ADD COLUMN IF NOT EXISTS player_name text,
  ADD COLUMN IF NOT EXISTS table_number integer;

-- 2) commander_spending_limits
--    pages/api/responsible-gaming/limits.js upserts and returns session_limit,
--    time_limit_hours and a master `enabled` toggle. The live table instead has
--    session_duration_limit (integer minutes), cooling_off_enabled and
--    alerts_enabled — none of which are an unambiguous rename target for these
--    three fields, so the columns are added to match the API contract.
ALTER TABLE public.commander_spending_limits
  ADD COLUMN IF NOT EXISTS session_limit numeric,
  ADD COLUMN IF NOT EXISTS time_limit_hours numeric,
  ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT false;

-- 3) commander_push_subscriptions
--    pages/api/notifications/subscribe.js (insert/update/select) and
--    pages/api/notifications/send.js (sendPushNotification select) use a
--    web-push / OneSignal shape. The live table only carries native-token
--    columns (device_token, device_type, device_name), so add the columns the
--    code reads and writes.
ALTER TABLE public.commander_push_subscriptions
  ADD COLUMN IF NOT EXISTS endpoint text,
  ADD COLUMN IF NOT EXISTS subscription_data jsonb,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS venue_id integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
