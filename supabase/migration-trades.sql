-- ============================================================
-- Trade Tracker (Polymarket-style) migration
-- Run this in Supabase SQL editor.
-- Also: create a PUBLIC storage bucket named `trade-screenshots`.
-- ============================================================

CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_a_id INT NOT NULL,
  team_a_name TEXT NOT NULL,
  team_b_id INT NOT NULL,
  team_b_name TEXT NOT NULL,
  round_executed INT NOT NULL,
  context_notes TEXT,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID REFERENCES trades(id) ON DELETE CASCADE,
  player_id INT NOT NULL,
  player_name TEXT NOT NULL,
  player_position TEXT,       -- normalised after DPP resolution (e.g., 'FWD')
  raw_position TEXT,          -- as recorded (e.g., 'MID/FWD')
  receiving_team_id INT NOT NULL,
  receiving_team_name TEXT NOT NULL,
  pre_trade_avg DECIMAL
);

CREATE TABLE IF NOT EXISTS trade_probabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID REFERENCES trades(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  team_a_probability DECIMAL NOT NULL,
  team_b_probability DECIMAL NOT NULL,
  factors JSONB,
  ai_assessment TEXT,
  calculated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(trade_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_trade_players_trade ON trade_players(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_probs_trade_round ON trade_probabilities(trade_id, round_number);
CREATE INDEX IF NOT EXISTS idx_trades_round ON trades(round_executed);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_probabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "all on trades" ON trades;
DROP POLICY IF EXISTS "all on trade_players" ON trade_players;
DROP POLICY IF EXISTS "all on trade_probs" ON trade_probabilities;

CREATE POLICY "all on trades" ON trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all on trade_players" ON trade_players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all on trade_probs" ON trade_probabilities FOR ALL USING (true) WITH CHECK (true);
