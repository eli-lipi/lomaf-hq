-- Admin-editable config for the Draft vs Reality board.
-- Single-row table keyed on id=1. Holds position benchmarks, round-based
-- scaling brackets, and availability thresholds.

CREATE TABLE IF NOT EXISTS draft_board_config (
  id INT PRIMARY KEY DEFAULT 1,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT draft_board_config_single_row CHECK (id = 1)
);

INSERT INTO draft_board_config (id, config) VALUES (
  1,
  '{
    "benchmarks": {
      "MID": { "elite": 100, "good": 85, "avg": 75 },
      "DEF": { "elite": 95,  "good": 80, "avg": 70 },
      "FWD": { "elite": 85,  "good": 75, "avg": 65 },
      "RUC": { "elite": 95,  "good": 80, "avg": 70 }
    },
    "round_brackets": [
      { "from": 1,  "to": 2,   "scale_pct": 6 },
      { "from": 3,  "to": 4,   "scale_pct": 3 },
      { "from": 5,  "to": 10,  "scale_pct": 0 },
      { "from": 11, "to": 15,  "scale_pct": -5 },
      { "from": 16, "to": 999, "scale_pct": -10 }
    ],
    "availability": {
      "bust_below_pct": 30,
      "cap_fair_below_pct": 50,
      "demote_below_pct": 75
    }
  }'::JSONB
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE draft_board_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on draft_board_config" ON draft_board_config;
CREATE POLICY "Allow all on draft_board_config" ON draft_board_config
  FOR ALL USING (true) WITH CHECK (true);
