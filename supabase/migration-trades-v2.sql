-- =============================================================
-- Trades v2 — methodology overhaul
-- =============================================================
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Adds:
--   trades.positive_team_id, negative_team_id    — frozen polarity
--   trades.team_a_ladder_at_trade, team_b_...     — ladder positions snapshot
--   trade_players.expected_avg                    — bet (locked at exec)
--   trade_players.expected_avg_source             — 'manual' | 'auto'
--   trade_players.expected_games                  — 0..4, default 4
--   trade_probabilities.advantage                 — ±100 relative-advantage
-- =============================================================

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS positive_team_id INT,
  ADD COLUMN IF NOT EXISTS negative_team_id INT,
  ADD COLUMN IF NOT EXISTS team_a_ladder_at_trade INT,
  ADD COLUMN IF NOT EXISTS team_b_ladder_at_trade INT;

ALTER TABLE trade_players
  ADD COLUMN IF NOT EXISTS expected_avg DECIMAL,
  ADD COLUMN IF NOT EXISTS expected_avg_source TEXT,
  ADD COLUMN IF NOT EXISTS expected_games DECIMAL DEFAULT 4;

ALTER TABLE trade_probabilities
  -- Signed advantage on the ±100 scale, snapped to 5%.
  -- Positive = positive_team is winning the trade.
  ADD COLUMN IF NOT EXISTS advantage DECIMAL;

-- Backfill polarity for any existing trades — defaults positive=team_a so
-- chart polarity is at least stable. Ladder positions left null; new trades
-- will populate them.
UPDATE trades
SET positive_team_id = team_a_id,
    negative_team_id = team_b_id
WHERE positive_team_id IS NULL;
