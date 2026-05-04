-- =============================================================
-- Round Control — make the platform round-aware
-- =============================================================
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Adds:
--   round_advances  — one row per round that's been "made live" by an
--                     explicit admin advance ceremony. Singleton-by-history:
--                     the platform's current round is just MAX(round_number)
--                     here.
--
-- Backfill: every round that already has a complete set of team_snapshots
-- (10 teams) is treated as historically advanced, so everyone lands on the
-- latest round on first deploy. emails_sent = TRUE so we don't retro-spam.
-- =============================================================

CREATE TABLE IF NOT EXISTS round_advances (
  round_number INT PRIMARY KEY,
  advanced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  advanced_by UUID REFERENCES users(id),
  emails_sent BOOL NOT NULL DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  notes TEXT
);

ALTER TABLE round_advances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on round_advances" ON round_advances;
CREATE POLICY "Allow all on round_advances" ON round_advances FOR ALL USING (true) WITH CHECK (true);

INSERT INTO round_advances (round_number, advanced_at, advanced_by, emails_sent)
SELECT s.round_number, COALESCE(MAX(s.created_at), now()), NULL, TRUE
FROM team_snapshots s
GROUP BY s.round_number
HAVING COUNT(DISTINCT s.team_id) >= 10
ON CONFLICT (round_number) DO NOTHING;
