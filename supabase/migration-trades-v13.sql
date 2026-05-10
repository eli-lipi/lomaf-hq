-- v13 — Injury/trade integration
--
-- Adds injury_at_trade JSONB column to trade_players. Captures the
-- player's AFL injury list state at trade execution time so we can
-- track recovery drift and grade the coach's decision, not just the
-- outcome.
--
-- JSONB shape:
-- {
--   "injury": "hamstring",
--   "estimated_return": "2-3 weeks",
--   "return_min_weeks": 2,
--   "return_max_weeks": 3,
--   "return_status": "weeks",
--   "source_updated_at": "2026-04-28",
--   "trend_status": "on_track",
--   "trend_summary": "On track · 2w on list, 3w to go"
-- }
-- NULL = player was not on the AFL injury list at trade time.

ALTER TABLE trade_players
  ADD COLUMN IF NOT EXISTS injury_at_trade JSONB;
