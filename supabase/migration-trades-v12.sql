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

-- Persist each player's draft_position on the trade_players row so the
-- player's identity in the league (drafted as a MID, drafted as a DEF,
-- etc.) travels with the trade. Lets the edit form, the AI analysis,
-- and any future tier work read a stable identity even when the player
-- has been dropped, picked up on waivers, etc.
ALTER TABLE trade_players
  ADD COLUMN IF NOT EXISTS draft_position TEXT,
  ADD COLUMN IF NOT EXISTS draft_pick INT;

-- Backfill from draft_picks so existing trades pick up the columns right
-- away without an Edit-pass.
UPDATE trade_players tp
SET draft_position = dp.position
FROM draft_picks dp
WHERE tp.player_id = dp.player_id
  AND tp.draft_position IS NULL
  AND dp.position IS NOT NULL;

UPDATE trade_players tp
SET draft_pick = dp.overall_pick
FROM draft_picks dp
WHERE tp.player_id = dp.player_id
  AND tp.draft_pick IS NULL
  AND dp.overall_pick IS NOT NULL
  AND dp.overall_pick > 0;
