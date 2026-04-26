-- Per-user activity tracking + AI usage attribution.

-- Attribute each AI call to the user who triggered it (nullable for old rows).
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS user_id UUID;
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user ON ai_usage_log(user_id);

-- Daily activity counter per user. One row per (user, day), incremented by
-- a heartbeat from the browser every minute the tab is visible.
CREATE TABLE IF NOT EXISTS user_activity (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  minutes_active INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_user_activity_date ON user_activity(activity_date);

ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on user_activity" ON user_activity;
CREATE POLICY "Allow all on user_activity" ON user_activity FOR ALL USING (true) WITH CHECK (true);

-- Atomic upsert+increment so concurrent heartbeats can't lose pings.
CREATE OR REPLACE FUNCTION increment_user_activity(p_user_id UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO user_activity (user_id, activity_date, minutes_active, updated_at)
  VALUES (p_user_id, p_date, 1, now())
  ON CONFLICT (user_id, activity_date)
  DO UPDATE SET minutes_active = user_activity.minutes_active + 1, updated_at = now();
END;
$$;
