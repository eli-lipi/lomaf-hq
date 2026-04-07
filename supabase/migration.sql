-- ============================================================
-- LOMAF HQ — Database Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- CSV upload audit log
CREATE TABLE IF NOT EXISTS csv_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INT NOT NULL,
  upload_type TEXT NOT NULL CHECK (upload_type IN ('lineups', 'teams', 'points_grid', 'draft')),
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  raw_data JSONB NOT NULL
);

-- Computed team stats per round
CREATE TABLE IF NOT EXISTS team_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INT NOT NULL,
  team_id INT NOT NULL,
  team_name TEXT NOT NULL,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  ties INT DEFAULT 0,
  pts_for DECIMAL DEFAULT 0,
  pts_against DECIMAL DEFAULT 0,
  pct DECIMAL DEFAULT 0,
  league_rank INT,
  def_total DECIMAL DEFAULT 0,
  mid_total DECIMAL DEFAULT 0,
  fwd_total DECIMAL DEFAULT 0,
  ruc_total DECIMAL DEFAULT 0,
  utl_total DECIMAL DEFAULT 0,
  def_rank INT,
  mid_rank INT,
  fwd_rank INT,
  ruc_rank INT,
  utl_rank INT,
  def_season_rank INT,
  mid_season_rank INT,
  fwd_season_rank INT,
  ruc_season_rank INT,
  utl_season_rank INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(round_number, team_id)
);

-- Draft picks (loaded once)
CREATE TABLE IF NOT EXISTS draft_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round INT NOT NULL,
  round_pick INT NOT NULL,
  overall_pick INT NOT NULL,
  team_name TEXT NOT NULL,
  team_id INT NOT NULL,
  player_name TEXT NOT NULL,
  player_id INT NOT NULL,
  drafted_at TIMESTAMPTZ,
  draft_method TEXT,
  position TEXT
);

-- Player scores per round (from lineups CSV)
CREATE TABLE IF NOT EXISTS player_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INT NOT NULL,
  team_id INT NOT NULL,
  team_name TEXT NOT NULL,
  player_id INT NOT NULL,
  player_name TEXT NOT NULL,
  pos TEXT NOT NULL,
  is_emg BOOLEAN DEFAULT false,
  is_scoring BOOLEAN DEFAULT false,
  points DECIMAL,
  UNIQUE(round_number, team_id, player_id)
);

-- PWRNKGs round metadata
CREATE TABLE IF NOT EXISTS pwrnkgs_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INT NOT NULL UNIQUE,
  theme TEXT,
  preview_text TEXT,
  week_ahead_text TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- PWRNKGs individual team rankings
CREATE TABLE IF NOT EXISTS pwrnkgs_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID REFERENCES pwrnkgs_rounds(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  team_id INT NOT NULL,
  team_name TEXT NOT NULL,
  ranking INT NOT NULL,
  previous_ranking INT,
  writeup TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(round_number, team_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_team_snapshots_round ON team_snapshots(round_number);
CREATE INDEX IF NOT EXISTS idx_team_snapshots_team ON team_snapshots(team_id);
CREATE INDEX IF NOT EXISTS idx_player_rounds_round ON player_rounds(round_number);
CREATE INDEX IF NOT EXISTS idx_player_rounds_team ON player_rounds(team_id);
CREATE INDEX IF NOT EXISTS idx_pwrnkgs_rankings_round ON pwrnkgs_rankings(round_number);

-- Disable RLS on all tables (single-admin portal)
ALTER TABLE csv_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE pwrnkgs_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE pwrnkgs_rankings ENABLE ROW LEVEL SECURITY;

-- Allow all operations via anon key (single admin, no auth needed)
CREATE POLICY "Allow all on csv_uploads" ON csv_uploads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on team_snapshots" ON team_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on draft_picks" ON draft_picks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on player_rounds" ON player_rounds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on pwrnkgs_rounds" ON pwrnkgs_rounds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on pwrnkgs_rankings" ON pwrnkgs_rankings FOR ALL USING (true) WITH CHECK (true);

-- Storage buckets (create manually in Supabase dashboard):
-- 1. coach-photos (public)
-- 2. carousel-images (public)
