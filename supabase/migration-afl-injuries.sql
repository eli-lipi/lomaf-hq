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
