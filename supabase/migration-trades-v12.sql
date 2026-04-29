-- =============================================================
-- Trades v12 — AI-written Trade Justification
-- =============================================================
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Adds:
--   trades.ai_justification  -- AI-written headline + bullet list explaining
--                               WHY the trade made sense. Locked at execution
--                               time, regenerated on edit. Format:
--                               'headline\n- bullet\n- bullet'.
--
-- Per the v12 plan, no data migration. Existing trades carry NULL until they
-- are next edited (or until an admin triggers a re-generation).
-- =============================================================

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS ai_justification TEXT;
