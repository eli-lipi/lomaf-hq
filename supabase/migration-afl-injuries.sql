-- =============================================================
-- AFL Injury List — official prognosis cache
-- =============================================================
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Caches the AFL.com.au public injury list. Refreshed inline on
-- round-advance and via a daily cron. Used by the trade analysis +
-- justification prompts so the AI cites the official prognosis ('2-3
-- weeks') instead of guessing 'Likely injured' from a DNP pattern.
--
-- Notes:
--   player_id is nullable — resolved at sync time by fuzzy-matching the
--   AFL.com.au player_name + club against player_rounds. Misses fall
--   through to a name-only lookup at narrative-generation time.
-- =============================================================

CREATE TABLE IF NOT EXISTS afl_injuries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  player_id INT,
  club_code TEXT NOT NULL,
  club_name TEXT NOT NULL,
  injury TEXT,
  estimated_return TEXT,
  return_min_weeks INT,
  return_max_weeks INT,
  return_status TEXT,
  source_updated_at DATE,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_name, club_code)
);

CREATE INDEX IF NOT EXISTS idx_afl_injuries_player_id ON afl_injuries(player_id);
CREATE INDEX IF NOT EXISTS idx_afl_injuries_club ON afl_injuries(club_code);

ALTER TABLE afl_injuries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on afl_injuries" ON afl_injuries;
CREATE POLICY "Allow all on afl_injuries" ON afl_injuries FOR ALL USING (true) WITH CHECK (true);

-- =============================================================
-- v12.3.1 — historical snapshots
-- =============================================================
-- AFL.com.au keeps only the current-week list. We want to detect
-- stalled / accelerating / cleared timelines, which means recording
-- one snapshot per AFL-update cycle. Keyed on (player, club,
-- source_updated_at) so re-syncs without an AFL update are no-ops.

CREATE TABLE IF NOT EXISTS afl_injury_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  player_id INT,
  club_code TEXT NOT NULL,
  injury TEXT,
  estimated_return TEXT,
  return_min_weeks INT,
  return_max_weeks INT,
  return_status TEXT,
  source_updated_at DATE,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_injury_snapshots_unique
  ON afl_injury_snapshots(player_name, club_code, source_updated_at);
CREATE INDEX IF NOT EXISTS idx_injury_snapshots_player_id
  ON afl_injury_snapshots(player_id, source_updated_at DESC);

ALTER TABLE afl_injury_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on afl_injury_snapshots" ON afl_injury_snapshots;
CREATE POLICY "Allow all on afl_injury_snapshots" ON afl_injury_snapshots
  FOR ALL USING (true) WITH CHECK (true);

-- Backfill: copy current state so the trend computer has at least one
-- data point per player from go-live.
INSERT INTO afl_injury_snapshots (
  player_name, player_id, club_code, injury, estimated_return,
  return_min_weeks, return_max_weeks, return_status, source_updated_at, scraped_at
)
SELECT
  player_name, player_id, club_code, injury, estimated_return,
  return_min_weeks, return_max_weeks, return_status, source_updated_at, scraped_at
FROM afl_injuries
ON CONFLICT (player_name, club_code, source_updated_at) DO NOTHING;
