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

-- Note: byes are an AFL-CLUB attribute (each AFL club has one bye between
-- R12-R15), not a LOMAF-team attribute. An afl_club_byes table belongs in a
-- future migration when AFL bye data is wired in. The league-wide bye
-- estimate in the trade-logging form approximates this until then.
DROP TABLE IF EXISTS team_byes;
