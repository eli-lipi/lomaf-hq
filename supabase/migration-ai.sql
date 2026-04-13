-- ============================================================
-- LOMAF HQ — AI Feature Tables
-- Run this AFTER migration.sql and migration-matchups.sql
-- ============================================================

-- Intelligence briefs (one per round)
CREATE TABLE IF NOT EXISTS ai_intelligence_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INT NOT NULL,
  brief_json JSONB NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(round_number)
);

-- Chart insights (per round, per section)
CREATE TABLE IF NOT EXISTS ai_chart_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INT NOT NULL,
  section_key TEXT NOT NULL,
  insights JSONB NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(round_number, section_key)
);

-- Usage log for cost tracking
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL,
  round_number INT,
  input_tokens INT,
  output_tokens INT,
  cost_estimate DECIMAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Editable system prompts (one row per prompt key). Falls back to hardcoded defaults in src/lib/ai.ts when absent.
CREATE TABLE IF NOT EXISTS ai_system_prompts (
  prompt_key TEXT PRIMARY KEY,
  prompt_text TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

-- Enable RLS but allow all for now (single-admin app)
ALTER TABLE ai_intelligence_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chart_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_system_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on ai_intelligence_briefs" ON ai_intelligence_briefs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ai_chart_insights" ON ai_chart_insights FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ai_usage_log" ON ai_usage_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ai_system_prompts" ON ai_system_prompts FOR ALL USING (true) WITH CHECK (true);
