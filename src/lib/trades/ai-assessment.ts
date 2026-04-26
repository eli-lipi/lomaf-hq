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

const NARRATIVE_SYSTEM_PROMPT = `You are the trade analyst for LOMAF, a fantasy AFL league. You are given per-round scores for every player involved in a trade since the trade was made. USE THE ACTUAL NUMBERS — do not make up stats. Cite specific scores in the narrative ("Rozee's R3 ton", "De Koning's 0 in R4", etc).

The season has 23 rounds. Finals start around R21. A "ton" is 100+, a "zero" is 0/DNP (injury or bye), a solid score is 80+. Typical stars average 90-120. Pay attention to:
- Each team's ladder position and finals chances
- Whether the trade plugged a line weakness (check line-rank columns: lower rank = stronger)
- Whether the outgoing players have kept scoring on their new team (the actual per-round scores tell you this)
- Injury / DNP patterns — a player with two straight DNPs after a big pre-trade avg is likely hurt
- "Win-now" vs "build-for-finals" depending on round and record

The "edge" field: which side is currently winning the trade based on points delivered so far? Magnitude 1-3 = slight, 4-6 = clear, 7-10 = decisive. If too early to tell (0-2 rounds of data), use magnitude 1-3.

Narrative: 3-4 sentences, punchy opinionated sports-analyst voice. Reference actual scores ("X averaged Y since the trade"), not generalities. End with the finals implication for each side.

Return ONLY valid JSON (no markdown fences):
{
  "edge": "team_a" | "team_b" | "even",
  "magnitude": 1-10,
  "narrative": "string (3-4 sentences, referencing actual scores from the data)"
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
