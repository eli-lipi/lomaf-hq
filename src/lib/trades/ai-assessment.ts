import { getAnthropicClient, AI_MODEL, parseAIJson, logAIUsage } from '@/lib/ai';
import { TEAMS } from '@/lib/constants';
import type { LeagueTeam } from '@/lib/types';
import type { AiEdge } from './types';

// ============================================================
// 1. Screenshot parsing (vision)
// ============================================================

export interface ParsedTradeScreenshot {
  team_a_name: string;
  team_a_id: number | null;
  team_a_receives: string[];
  team_b_name: string;
  team_b_id: number | null;
  team_b_receives: string[];
  round_executed: number | null;
  confidence: 'high' | 'medium' | 'low';
  raw_parse: unknown;
}

const SCREENSHOT_SYSTEM_PROMPT = `You are parsing a screenshot of a fantasy AFL trade from the fantasy-footy platform. Extract the trade details and return valid JSON only.

The 10 teams in this league are: Mansion Mambas, South Tel Aviv Dragons, I believe in SEANO, Littl' bit LIPI, Melech Mitchito, Cripps Don't Lie, Take Me Home Country Road, Doge Bombers, Gun M Down, Warnered613.

Return this exact JSON structure:
{
  "team_a_name": "string",
  "team_a_receives": ["Player Name", "Player Name"],
  "team_b_name": "string",
  "team_b_receives": ["Player Name", "Player Name"],
  "round_executed": number or null,
  "confidence": "high" | "medium" | "low"
}

Use the exact team names from the list above. Return ONLY the JSON, no markdown fences.`;

function fuzzyMatchTeam(raw: string): LeagueTeam | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  // 1. Exact match
  let hit = TEAMS.find((t) => t.team_name.toLowerCase() === lower);
  if (hit) return hit;
  // 2. Includes
  hit = TEAMS.find(
    (t) => t.team_name.toLowerCase().includes(lower) || lower.includes(t.team_name.toLowerCase())
  );
  if (hit) return hit;
  // 3. Token overlap — any word match
  const rawTokens = lower.split(/\s+/).filter((w) => w.length > 2);
  for (const t of TEAMS) {
    const teamTokens = t.team_name.toLowerCase().split(/\s+/);
    if (rawTokens.some((w) => teamTokens.some((tw) => tw.includes(w) || w.includes(tw)))) {
      return t;
    }
  }
  return null;
}

export async function parseTradeScreenshot(
  base64: string,
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  currentRound: number | null,
  userId: string | null = null,
): Promise<ParsedTradeScreenshot> {
  const client = getAnthropicClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured');

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1000,
    system: SCREENSHOT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: 'Parse this trade screenshot. Extract both teams, which players each team receives, and which round it was executed in if visible.',
          },
        ],
      },
    ],
  });

  logAIUsage(supabase, 'trades.parse_screenshot', currentRound, response.usage.input_tokens, response.usage.output_tokens, userId).catch(() => {});

  const text = response.content.find((c) => c.type === 'text');
  if (!text || text.type !== 'text') throw new Error('No text response from Claude');

  const parsed = parseAIJson<{
    team_a_name: string;
    team_a_receives: string[];
    team_b_name: string;
    team_b_receives: string[];
    round_executed: number | null;
    confidence: 'high' | 'medium' | 'low';
  }>(text.text);

  const teamA = fuzzyMatchTeam(parsed.team_a_name);
  const teamB = fuzzyMatchTeam(parsed.team_b_name);

  return {
    team_a_name: teamA?.team_name ?? parsed.team_a_name,
    team_a_id: teamA?.team_id ?? null,
    team_a_receives: parsed.team_a_receives ?? [],
    team_b_name: teamB?.team_name ?? parsed.team_b_name,
    team_b_id: teamB?.team_id ?? null,
    team_b_receives: parsed.team_b_receives ?? [],
    round_executed: parsed.round_executed,
    confidence: parsed.confidence,
    raw_parse: parsed,
  };
}

// ============================================================
// 2. Combined narrative + edge assessment
// ============================================================

export interface TradeNarrativeInputs {
  teamA: { name: string; ladder: number | null; record: string; preTradeLines: LineRanks; currentLines: LineRanks };
  teamB: { name: string; ladder: number | null; record: string; preTradeLines: LineRanks; currentLines: LineRanks };
  teamAReceives: string[];
  teamBReceives: string[];
  roundExecuted: number;
  currentRound: number;
  contextNotes: string | null;
  playerBreakdown: string; // pre-formatted per-player status text
  probA: number;
  probB: number;
}

export interface LineRanks {
  def: number | null;
  mid: number | null;
  fwd: number | null;
  ruc: number | null;
}

export interface NarrativeResult {
  edge: AiEdge;
  magnitude: number; // 1-10
  narrative: string;
}

const NARRATIVE_SYSTEM_PROMPT = `You are the trade analyst for LOMAF, a fantasy AFL league. You write the "Trade Analysis" — the headline read of how a trade is playing out for each side.

You are given:
- Each player's EXPECTED AVERAGE — this is the EXPLICIT BET locked at trade execution. It is the ONLY bar each player needs to clear for the trade to make sense. Derived from a position-tier baseline blended with recent form, then optionally overridden by the receiving coach. THIS IS THE PREDICTION.
- Each player's PRE-TRADE SEASON-TO-DATE AVERAGE — labelled clearly as small-sample and NOT a prediction. Treat it as context for HOW the player has played in the small slice of season before the trade, NOT as the bar to clear. Especially for trades made in early rounds (R1–R5), pre-trade avg is noisy — a player with one tonne and one zero shows 50, but their EXPECTED is 90 because that's what the league expects from them. NEVER frame underperformance as 'X is averaging 79 vs his 108 prediction' when 108 was the season-to-date avg, not the bet.
- Per-round scores both BEFORE and AFTER the trade.
- The original admin context note (if present) — the human reasoning behind the trade.

USE THE ACTUAL NUMBERS — do not make up stats. Cite specific scores ("Rozee's R3 ton", "De Koning's 0 in R4", etc) AND compare actual output to EXPECTED average ("Mills was bet at 95, has averaged 71 since — under the bar by 24/rd"). The pre-trade season-to-date avg is fine to mention for colour ("torrid first 3 rounds dragged his pre-trade avg to 65") but never frame it as the prediction.

If the player breakdown includes a "trader's note" line (e.g., "Injured at trade time, expected return R5"), WEIGHT IT HEAVILY. A DNP that the trader explicitly priced in is fundamentally different from a surprise injury — your analysis should reflect that. Phrases like "the Mambas knew Rozee was injured but the timeline has slipped" are appropriate when the note flagged it; treat unforeseen DNPs as straight bad luck or buyer's-remorse material.

The season has 23 rounds. Finals start around R21. A "ton" is 100+, a "zero" is 0/DNP (injury or bye), a solid score is 80+. Typical stars average 90-120. Consider:
- The original intent (from the context note) and whether it's playing out
- Each player's actual avg vs. their EXPECTED avg (the explicit bet) — that's the trade's verdict on output. NOT pre-trade season-to-date avg.
- Injury / DNP patterns — a player with two straight DNPs after a big pre-trade avg is likely hurt
- Each team's ladder position and finals chances
- Whether the trade plugged a line weakness (check line-rank columns: lower rank = stronger)

CRITICAL — POLARITY ALIGNMENT WITH THE WIN PROBABILITY:
The user message includes the current win probability for each team (e.g. "Doge Bombers 70% vs Warnered613 30%"). This probability is computed from raw production, scarcity, projected value, and AI inputs — it is the AUTHORITATIVE read of who is winning the trade. Your narrative MUST be consistent with this probability:
- If Team X is at >55%, your headline and bullets must read as Team X winning the trade overall, even if a couple of their players are underperforming expectations. Lead with Team X's advantage; underperformance becomes a "despite this" sub-point, not the headline.
- If both teams are within 50–55%, frame it as too close to call.
- Never write a headline that names the losing team (per the probability) as "clearly winning" or "dominating". The two must agree.
- The "edge" field MUST match: prob A > prob B → edge = "team_a"; prob B > prob A → edge = "team_b"; within 5pp → "even".

Magnitude 1-3 = slight, 4-6 = clear, 7-10 = decisive. Map roughly to the probability gap: 5–15pp = 1-3, 15-30pp = 4-6, 30pp+ = 7-10. If too early to tell (0-2 rounds of data), use magnitude 1-3.

Narrative format (v10): a tight tabloid-style headline plus 3–5 bullet points.
- The headline is ONE punchy line, MAX 12 WORDS, capturing the core take. Like a tabloid lead. Ends with a period or exclamation.
- The bullets are 3–5 items, each ONE punchy sentence (max ~20 words). Each bullet should be a TAKE or a SHARP DATA POINT framed as a take — not a bare fact. Cite specific scores and the predicted-vs-actual gap. The last bullet should land the finals implication.
- Render as a string with the headline on the first line, then each bullet prefixed with '- ' on its own line. Example:

The Mambas' Rozee acquisition has been a disaster.
- Rozee has missed all 5 post-trade rounds with injury — zero return on the marquee pickup.
- Ryan has delivered a steady 79 average for Doge across 5 rounds (58, 36, 121, 90).
- Tim Freed traded away his most consistent defender for a player who never suited up.
- For a contender sitting 2nd, this trade could prove costly come finals.

Return ONLY valid JSON (no markdown fences):
{
  "edge": "team_a" | "team_b" | "even",
  "magnitude": 1-10,
  "narrative": "string — headline on first line then 3-5 bullets each prefixed with '- ', max 12 words on the headline, max ~20 words per bullet"
}`;

function lineRanksStr(lines: LineRanks): string {
  return `DEF:${lines.def ?? '?'} MID:${lines.mid ?? '?'} FWD:${lines.fwd ?? '?'} RUC:${lines.ruc ?? '?'}`;
}

export async function generateTradeNarrative(
  inputs: TradeNarrativeInputs,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<NarrativeResult> {
  const client = getAnthropicClient();
  if (!client) {
    // Fallback when AI is not configured
    return { edge: 'even', magnitude: 0, narrative: '' };
  }

  const userMsg = `Trade executed in Round ${inputs.roundExecuted} (currently Round ${inputs.currentRound} of 23, finals start R21):

${inputs.teamA.name} (${inputs.teamA.record}, Ladder: ${inputs.teamA.ladder ?? '?'}) received: ${inputs.teamAReceives.join(', ')}
${inputs.teamB.name} (${inputs.teamB.record}, Ladder: ${inputs.teamB.ladder ?? '?'}) received: ${inputs.teamBReceives.join(', ')}

Admin context: "${inputs.contextNotes ?? 'None provided'}"

${inputs.teamA.name} line rankings at time of trade: ${lineRanksStr(inputs.teamA.preTradeLines)}
${inputs.teamA.name} current line rankings: ${lineRanksStr(inputs.teamA.currentLines)}

${inputs.teamB.name} line rankings at time of trade: ${lineRanksStr(inputs.teamB.preTradeLines)}
${inputs.teamB.name} current line rankings: ${lineRanksStr(inputs.teamB.currentLines)}

Player status since trade:
${inputs.playerBreakdown}

Current probability: ${inputs.teamA.name} ${inputs.probA.toFixed(1)}% vs ${inputs.teamB.name} ${inputs.probB.toFixed(1)}%

Assess the edge and magnitude, and write the narrative.`;

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 600,
    system: NARRATIVE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });

  logAIUsage(supabase, 'trades.narrative', inputs.currentRound, response.usage.input_tokens, response.usage.output_tokens).catch(() => {});

  const text = response.content.find((c) => c.type === 'text');
  if (!text || text.type !== 'text') {
    return { edge: 'even', magnitude: 0, narrative: '' };
  }

  try {
    const parsed = parseAIJson<NarrativeResult>(text.text);
    const edge: AiEdge =
      parsed.edge === 'team_a' || parsed.edge === 'team_b' ? parsed.edge : 'even';
    const magnitude = Math.max(0, Math.min(10, Math.round(parsed.magnitude || 0)));
    return { edge, magnitude, narrative: parsed.narrative || '' };
  } catch {
    // On parse failure, treat as even/no narrative
    return { edge: 'even', magnitude: 0, narrative: text.text.slice(0, 1000) };
  }
}

// ============================================================
// 3. Trade Justification (v12)
// ============================================================
// Locked at trade-execution time. Reads the WHY: line ranks, position
// needs, expected averages, the admin context note. Output is a
// "headline + bullets" string in the same shape as the analysis so the
// detail page renders it with the same component.

export interface TradeJustificationInputs {
  teamA: { name: string; ladder: number | null; record: string; preTradeLines: LineRanks };
  teamB: { name: string; ladder: number | null; record: string; preTradeLines: LineRanks };
  // Pre-formatted player block: per-player position, expected avg/tier,
  // pre-trade avg, per-player context note. Built by the caller.
  playerBreakdown: string;
  roundExecuted: number;
  contextNotes: string | null;
}

const JUSTIFICATION_SYSTEM_PROMPT = `You are the trade analyst for LOMAF, a fantasy AFL draft league. You write the "Trade Justification" — the WHY of a trade at the moment it was made. This is locked at trade-execution time and does NOT update with future round results.

You are given:
- Each team's record + ladder position at trade time
- Each team's line rankings at trade time (DEF / MID / FWD / RUC — lower rank = stronger line, 1 = best in league, 10 = worst)
- Each player moved: position, the EXPECTED AVERAGE the receiving coach is betting on (not the player's prior avg — the bet), pre-trade season avg, and any per-player context the trader recorded ("injured at trade time", "selling high", etc.)
- The admin's free-text context note (if present)

WRITE A SHARP, DATA-GROUNDED JUSTIFICATION OF WHY THIS TRADE MAKES SENSE FOR EACH SIDE. Use the actual numbers. Cite line ranks ("MID line ranked 8th — desperate for a top-tier mid"), expected averages ("betting Mills delivers 95+/rd"), positions, and the trader's stated reasoning if it's there. Read the trade as a coach would — what hole is each side plugging, what edge are they buying, what risk are they tolerating.

Format: a tight headline (≤14 words) followed by 3–5 bullets. Each bullet is one punchy sentence (max ~22 words), grounded in a specific number or position need. Cover:
- What each team gives up vs. gets (output bet, position, tier shift)
- What weakness the trade plugs (line ranks, ladder pressure, finals window)
- Any explicit risk the per-player context flags (injury, hot-streak risk, suspension)
- A finals/ladder framing where relevant

Render the output as a single string — headline on the first line, then each bullet prefixed with '- ' on its own line. Example:

Mansion buys ruck stability and Doge bets on Bontempelli's ceiling.
- Mansion's ruck line was ranked 9th (worst in league bar one); Witts plugs it with a Good 85+ avg expectation.
- Doge gives up a steady ruck to chase Bontempelli's 110+ ceiling — pure upside play with finals two months out.
- Trader flagged Bontempelli's calf history; Doge knew the injury risk and priced it into the bet.
- Mansion sits 6th and needs week-to-week consistency; Witts delivers floor over upside.

Return ONLY valid JSON (no markdown fences):
{
  "justification": "string — headline on first line then 3-5 bullets each prefixed with '- '"
}`;

export async function generateTradeJustification(
  inputs: TradeJustificationInputs,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<string> {
  const client = getAnthropicClient();
  if (!client) return '';

  const userMsg = `Trade executed in Round ${inputs.roundExecuted}.

${inputs.teamA.name} (${inputs.teamA.record}, Ladder: ${inputs.teamA.ladder ?? '?'})
  Line ranks at trade: ${lineRanksStr(inputs.teamA.preTradeLines)}

${inputs.teamB.name} (${inputs.teamB.record}, Ladder: ${inputs.teamB.ladder ?? '?'})
  Line ranks at trade: ${lineRanksStr(inputs.teamB.preTradeLines)}

Admin context: "${inputs.contextNotes ?? 'None provided'}"

Players moved (with the bet each receiving coach is making):
${inputs.playerBreakdown}

Write the justification.`;

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 600,
    system: JUSTIFICATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });

  logAIUsage(supabase, 'trades.justification', inputs.roundExecuted, response.usage.input_tokens, response.usage.output_tokens).catch(() => {});

  const text = response.content.find((c) => c.type === 'text');
  if (!text || text.type !== 'text') return '';

  try {
    const parsed = parseAIJson<{ justification: string }>(text.text);
    return parsed.justification || '';
  } catch {
    return text.text.slice(0, 1200);
  }
}
