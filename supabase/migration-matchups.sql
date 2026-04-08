-- Matchup rounds: per-team per-round matchup data from the matchups CSV
CREATE TABLE IF NOT EXISTS matchup_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INT NOT NULL,
  team_id INT NOT NULL,
  team_name TEXT NOT NULL,
  score_for DECIMAL NOT NULL DEFAULT 0,
  score_against DECIMAL NOT NULL DEFAULT 0,
  win BOOLEAN DEFAULT false,
  loss BOOLEAN DEFAULT false,
  tie BOOLEAN DEFAULT false,
  opp_name TEXT,
  opp_id INT,
  fixture_id INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(round_number, team_id)
);

-- Score adjustments: tracks discrepancies between matchup/manual scores and lineup sums
CREATE TABLE IF NOT EXISTS score_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INT NOT NULL,
  team_id INT NOT NULL,
  team_name TEXT NOT NULL,
  correct_score DECIMAL NOT NULL,
  lineup_score DECIMAL NOT NULL,
  adjustment DECIMAL NOT NULL,
  source TEXT DEFAULT 'auto',
  assigned_line TEXT,
  note TEXT,
  status TEXT DEFAULT 'unconfirmed',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(round_number, team_id)
);

-- Seed known discrepancies from R1-R4
INSERT INTO score_adjustments (round_number, team_id, team_name, correct_score, lineup_score, adjustment, source, status)
VALUES
  (3, 3194010, 'Cripps Don''t Lie', 1557, 1510, 47, 'auto', 'unconfirmed'),
  (3, 3194006, 'Melech Mitchito', 1492, 1549, -57, 'auto', 'unconfirmed'),
  (4, 3194003, 'Littl'' bit LIPI', 1394, 1331, 63, 'manual', 'unconfirmed'),
  (4, 3194002, 'Mansion Mambas', 1429, 1377, 52, 'manual', 'unconfirmed')
ON CONFLICT (round_number, team_id) DO NOTHING;
