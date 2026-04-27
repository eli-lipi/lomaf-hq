-- =============================================================
-- Trades v11 — universal tier system + per-player context
-- =============================================================
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Adds:
--   trade_players.expected_tier            -- 'superstar' | 'elite' | 'good' | 'average' | 'unrated'
--   trade_players.expected_games_remaining -- raw games over the post-trade window
--   trade_players.expected_games_max       -- max-available at trade time, for "expected vs max"
--   trade_players.player_context           -- free-text thesis per player
--   teams_bye.bye_round                    -- per-team bye round (R12-R15 typically)
--
-- Per the v11 addendum, no data migration is performed. Existing trades
-- carry NULL on these new columns until an admin re-edits them.
-- =============================================================

ALTER TABLE trade_players
  ADD COLUMN IF NOT EXISTS expected_tier TEXT,
  ADD COLUMN IF NOT EXISTS expected_games_remaining INT,
  ADD COLUMN IF NOT EXISTS expected_games_max INT,
  ADD COLUMN IF NOT EXISTS player_context TEXT;

-- Optional helper table for bye rounds. If teams already have a column
-- somewhere else for this, the helper table is harmless overlap.
CREATE TABLE IF NOT EXISTS team_byes (
  team_id INT PRIMARY KEY,
  bye_round INT
);
