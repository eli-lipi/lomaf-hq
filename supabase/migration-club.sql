-- Add AFL club column to player_rounds.
-- Populated from the Points Grid CSV (column 3: ADE, BRL, CAR, etc.).
-- Used by the AFL Concentration analytics tab.

ALTER TABLE player_rounds
  ADD COLUMN IF NOT EXISTS club TEXT;

-- Optional: index for concentration queries (filter by round_number, group by club)
CREATE INDEX IF NOT EXISTS idx_player_rounds_club
  ON player_rounds (round_number, club)
  WHERE club IS NOT NULL;
