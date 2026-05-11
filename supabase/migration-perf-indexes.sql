-- Performance pass: indexes for hot queries identified during the
-- v13.2-v13.4 perf work. Run this in the Supabase SQL editor. All
-- statements are idempotent (CREATE INDEX IF NOT EXISTS), so re-running
-- is safe.
--
-- Why each index:

-- ── player_rounds ──────────────────────────────────────────────────
-- Trades list + detail: `.in('player_id', [...]).lte('round_number', N)`.
-- Composite leads with player_id (the filter set is bounded by trade
-- participants), then round_number for the range predicate.
CREATE INDEX IF NOT EXISTS idx_player_rounds_player_round
  ON player_rounds (player_id, round_number);

-- Byes data route + verifyRoundReady: `.eq('round_number', N)` (single
-- round, all players). Reverse composite — leads with round_number.
CREATE INDEX IF NOT EXISTS idx_player_rounds_round
  ON player_rounds (round_number);

-- ── afl_injuries / snapshots ───────────────────────────────────────
-- Both lookups use `.in('player_id', [...])`. afl_injuries also gets
-- ordered by club + name on the /injuries page, but that scan is small.
CREATE INDEX IF NOT EXISTS idx_afl_injuries_player_id
  ON afl_injuries (player_id);

CREATE INDEX IF NOT EXISTS idx_afl_injury_snapshots_player_id
  ON afl_injury_snapshots (player_id);

-- ── Trade-side joins ───────────────────────────────────────────────
-- trade_players: `.in('trade_id', [...])` (list) and `.eq('trade_id', x)`
-- (detail). Both benefit from an index on trade_id.
CREATE INDEX IF NOT EXISTS idx_trade_players_trade_id
  ON trade_players (trade_id);

-- trade_probabilities: same pattern as trade_players, plus we sort by
-- round_number. Composite makes the sort free for the per-trade slice.
CREATE INDEX IF NOT EXISTS idx_trade_probabilities_trade_round
  ON trade_probabilities (trade_id, round_number);

-- draft_picks: `.in('player_id', [...])` on every trade detail.
CREATE INDEX IF NOT EXISTS idx_draft_picks_player_id
  ON draft_picks (player_id);

-- ── Round ledger ───────────────────────────────────────────────────
-- getCurrentRound / getCurrentRoundRow do
-- `.order('round_number', desc).limit(1)`. A descending index on
-- round_number makes that a single-row index seek.
CREATE INDEX IF NOT EXISTS idx_round_advances_round_desc
  ON round_advances (round_number DESC);

-- ── Users / auth path ──────────────────────────────────────────────
-- getCurrentUser does `.eq('email', lower(email))`. If email is already
-- the primary key / unique, this is a no-op; otherwise it's a meaningful
-- save on the per-request DB lookup.
CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (lower(email));

-- ── Done. Verify with ──────────────────────────────────────────────
--   SELECT indexname FROM pg_indexes WHERE schemaname='public'
--     ORDER BY tablename, indexname;
