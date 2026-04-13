import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export const AI_MODEL = 'claude-sonnet-4-20250514';

/**
 * Parse a JSON response from Claude, handling markdown code fences.
 */
export function parseAIJson<T>(raw: string): T {
  const clean = raw.replace(/```json\s*|```\s*/g, '').trim();
  return JSON.parse(clean);
}

/**
 * Log AI usage to Supabase (fire-and-forget).
 */
export async function logAIUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  endpoint: string,
  roundNumber: number | null,
  inputTokens: number,
  outputTokens: number
) {
  const costEstimate =
    (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
  await supabase.from('ai_usage_log').insert({
    endpoint,
    round_number: roundNumber,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_estimate: Math.round(costEstimate * 10000) / 10000,
  });
}

export const COACH_PERSONALITIES: Record<string, string> = {
  'Tim Freed': 'Reigning champ. The "ultimate professional." Meticulous drafter. Always prepared.',
  'Jacob Wytwornik': 'Veteran, historically lower-ranked. Known for complaining when players revert to average. Having a breakout 2026.',
  'Shir Maran & Coby Felbel': 'Co-coached tag team. Coby has a dodgy left knee (running joke). Disciplined approach in 2026.',
  'Lipi': 'Ex-commissioner. Writes the PWRNKGs. Self-deprecating but competitive. Current "Power Broker" at the trade table.',
  'Gadi Herskovitz': '2025 home-and-away champ. Under-the-radar. Recently more engaged due to living with mother-in-law in Netanya.',
  'Daniel Penso': 'Works in finance. Refuses to trade (Bibi-grade loss aversion). Perennially ranked 6th-7th.',
  'Alon Esterman': 'Enthusiastic, high-engagement. Observant (shabbat references). Brisbane Lions fan. Prays for his fantasy team at temple mount.',
  'Ronen Slonim': 'Current commissioner. Struggling with the job. Spreadsheet voodoo saga has been a distraction.',
  'Josh Sacks': 'Over-relies on AI Agents for draft prep. Currently on miluim (army reserve). Aggressive trader.',
  'Lior Davis': 'Spends lots of time abroad (eligibility questioned). Hawks/West Coast fan. Claims his defense is "theoretically stacked."',
};

export const INTELLIGENCE_BRIEF_SYSTEM_PROMPT = `You are the intelligence analyst for LOMAF (Land of Milk and Fantasy), a 10-coach AFL Fantasy draft league of ex-Australians living in Israel. You help Lipi write the weekly PWRNKGs (Power Rankings).

Your tone is: punchy, data-driven, roast-heavy, self-aware, and funny. Think sports talk radio meets a WhatsApp group of mates. Lead with takes, not stats. Use data as ammunition, not decoration.

Coach personalities (use these to personalize insights):
- Tim Freed (Mansion Mambas): Reigning champ. The "ultimate professional." Meticulous drafter.
- Jacob Wytwornik (South Tel Aviv Dragons): Veteran, historically lower-ranked. Known for complaining when players revert to average. Having a breakout 2026.
- Shir Maran & Coby Felbel (I believe in SEANO): Co-coached tag team. Coby has a dodgy left knee (running joke). Disciplined approach in 2026.
- Lipi (Littl' bit LIPI): Ex-commissioner. Writes the PWRNKGs. Self-deprecating but competitive. Current "Power Broker" at the trade table.
- Gadi Herskovitz (Melech Mitchito): 2025 home-and-away champ. Under-the-radar. Recently more engaged due to living with mother-in-law in Netanya.
- Daniel Penso (Cripps Don't Lie): Works in finance. Refuses to trade (Bibi-grade loss aversion). Perennially ranked 6th-7th.
- Alon Esterman (Take Me Home Country Road): Enthusiastic, high-engagement. Observant (shabbat references). Brisbane Lions fan. Prays for his fantasy team at temple mount.
- Ronen Slonim (Doge Bombers): Current commissioner. Struggling with the job. Spreadsheet voodoo saga has been a distraction.
- Josh Sacks (Gun M Down): Over-relies on AI Agents for draft prep. Currently on miluim (army reserve). Aggressive trader.
- Lior Davis (Warnered613): Spends lots of time abroad (eligibility questioned). Hawks/West Coast fan. Claims his defense is "theoretically stacked."

Output format: Return valid JSON with this structure:
{
  "storylines": ["string", "string", ...],
  "trade_implications": ["string", "string", ...],
  "ranking_suggestions": [
    { "ranking": 1, "team": "Team Name", "justification": "string" },
    ...
  ],
  "team_ammunition": {
    "Team Name": ["bullet point 1", "bullet point 2", "bullet point 3"],
    ...
  }
}`;

export const CHART_INSIGHTS_SYSTEM_PROMPT = `You are a punchy sports analytics commentator for a fantasy AFL league called LOMAF (Land of Milk and Fantasy). All 10 coaches are ex-Australians living in Israel. Give 2-3 non-obvious insights based on the data. Be specific — name teams and players where relevant. Each insight should be one sentence that makes someone want to argue or share it. Return as a JSON array of strings.`;

export type EditablePromptKey = 'intelligence_brief' | 'chart_insights';

export const PROMPT_DEFAULTS: Record<EditablePromptKey, string> = {
  intelligence_brief: INTELLIGENCE_BRIEF_SYSTEM_PROMPT,
  chart_insights: CHART_INSIGHTS_SYSTEM_PROMPT,
};

export const PROMPT_LABELS: Record<EditablePromptKey, { title: string; description: string }> = {
  intelligence_brief: {
    title: 'Intelligence Brief',
    description: 'Analyzes league data and produces the weekly JSON brief used to draft PWRNKGs.',
  },
  chart_insights: {
    title: 'Chart Insights',
    description: 'Generates 2–3 punchy insights that appear alongside charts on analytics pages.',
  },
};

/**
 * Fetch an editable system prompt from Supabase, falling back to the hardcoded default
 * if the row is missing, empty, or the query errors.
 */
export async function getSystemPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  key: EditablePromptKey
): Promise<string> {
  const fallback = PROMPT_DEFAULTS[key];
  try {
    const { data, error } = await supabase
      .from('ai_system_prompts')
      .select('prompt_text')
      .eq('prompt_key', key)
      .maybeSingle();
    if (error || !data?.prompt_text || !data.prompt_text.trim()) return fallback;
    return data.prompt_text;
  } catch {
    return fallback;
  }
}
