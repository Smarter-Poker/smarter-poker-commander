-- 2026-07-29 Financial/Billing schema-wiring sweep
-- Adds columns that FINANCIAL cluster API routes already write/read/filter but
-- which do not exist on the live schema, so the corresponding features error at
-- runtime (PGRST204 on writes / 42703 on selects+filters).
--
-- PROPOSED, not yet reviewed. All statements use IF NOT EXISTS so they are safe
-- to run more than once. See the PR description for the open decision on the
-- commander_table_sessions columns (add them, as here, vs. reworking time
-- billing onto the amount_paid / 'time_purchase' cash-transaction model already
-- used by pages/api/cashier/receipt.js and
-- pages/api/time-billing/sessions/[id]/payment.js).

--------------------------------------------------------------------------------
-- commander_table_sessions
-- Written by:
--   pages/api/time-billing/sessions/index.js       (POST - session start)
--   pages/api/time-billing/sessions/[id]/stop.js   (POST - session stop)
-- started_by is text to mirror the existing ended_by (text) column.
--------------------------------------------------------------------------------
ALTER TABLE public.commander_table_sessions
  ADD COLUMN IF NOT EXISTS rate_per_hour    numeric,
  ADD COLUMN IF NOT EXISTS total_charge     numeric,
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS started_by       text;

--------------------------------------------------------------------------------
-- commander_tax_events
-- Selected / filtered / written by pages/api/tax/w2g.js
--   GET   listTaxEvents  - selects + filters + orders by event_date
--   POST  generateW2G    - writes withholding_rate, w2g_document_url
--   PATCH updateTaxEvent - writes notes, player_acknowledged, acknowledged_at
-- Without these columns the W-2G tax-compliance route errors on every method.
-- Confirm event_date type (date here) matches how tax-event rows are created
-- upstream before applying.
--------------------------------------------------------------------------------
ALTER TABLE public.commander_tax_events
  ADD COLUMN IF NOT EXISTS event_date          date,
  ADD COLUMN IF NOT EXISTS withholding_rate    numeric,
  ADD COLUMN IF NOT EXISTS w2g_document_url    text,
  ADD COLUMN IF NOT EXISTS player_acknowledged boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledged_at     timestamptz,
  ADD COLUMN IF NOT EXISTS notes               text;
