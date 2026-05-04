-- =============================================================
-- Players — canonical season-wide AFL Fantasy data
-- =============================================================
-- Run in the Supabase SQL editor. Idempotent.
--
-- The players CSV from AFL Fantasy is the master per-season record:
-- name, AFL club, position (DPP-aware), LOMAF owner, plus form +
-- projection stats. Used as:
--   - canonical position fallback when player_rounds.pos is null/BN/UTL
--   - source of truth for ownership in /injuries
--   - foundation for projAvg / form / value tooling later
-- =============================================================

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id INT,                 -- resolved from player_rounds via name+club join
  player_name TEXT NOT NULL,
  afl_club TEXT NOT NULL,        -- AFL Fantasy 3-letter club code (COL, GEE, ...)
  position TEXT,                 -- DEF / MID / FWD / RUC, may be DPP combo (MID/FWD)
  owner_team_name TEXT,          -- LOMAF coach name if rostered, else null
  age INT,
  career_games INT,
  seasons INT,
  adp DECIMAL,
  owned_pct DECIMAL,
  proj_avg DECIMAL,
  avg_pts DECIMAL,
  total_pts INT,
  last5_avg DECIMAL,
  last3_avg DECIMAL,
  last1 DECIMAL,
  games_played INT,
  tog_pct DECIMAL,
  kicks DECIMAL,
  handballs DECIMAL,
  marks DECIMAL,
  hitouts DECIMAL,
  tackles DECIMAL,
  goals DECIMAL,
  behinds DECIMAL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_name, afl_club)
);

CREATE INDEX IF NOT EXISTS idx_players_player_id ON players(player_id);
CREATE INDEX IF NOT EXISTS idx_players_owner ON players(owner_team_name);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on players" ON players;
CREATE POLICY "Allow all on players" ON players FOR ALL USING (true) WITH CHECK (true);
