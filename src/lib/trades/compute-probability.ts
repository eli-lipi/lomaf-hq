import type {
  AiEdge,
  TradeFactorsBreakdown,
  PlayerPerformance,
} from './types';
import { snap5 } from './scale';

// =====================================================================
// Tunable constants — tweak here, not in calling sites
// =====================================================================
export const SCALING_FACTOR = 1.6;             // sigmoid scaling on the ±100 scale
export const CONFIDENCE_RAMP_ROUNDS = 8;       // rounds to reach full confidence
export const INJURY_MIN_CONSECUTIVE_ZEROS = 2;
export const INJURY_PRE_AVG_THRESHOLD = 60;
export const INJURY_RETURN_PROBABILITY = 0.7;
export const TOTAL_REGULAR_SEASON_ROUNDS = 23;
export const FINALS_START_ROUND = 21;

// v2 weights (perf vs expected = 70%, availability = 30%)
export const W_PERFORMANCE = 0.70;
export const W_AVAILABILITY = 0.30;
// Floor for reference-baseline expected_avg — used as a soft denominator in
// availability drag so a tiny pre-trade-avg player doesn't skew the math.
export const AVAILABILITY_REF_AVG = 70;

// =====================================================================
// Helpers exported for re-use elsewhere
// =====================================================================

export function magnitudeToPct(magnitude: number): number {
  if (magnitude <= 0) return 0;
  if (magnitude <= 3) return 4;     // bumped slightly for the ±100 scale
  if (magnitude <= 6) return 10;
  return 16;
}

/**
 * Detect likely-injured status for a player.
 * Flag: >=2 consecutive recent zero/null rounds AND pre_trade_avg >= 60.
 */
export function detectInjury(
  recentScores: (number | null)[],
  preTradeAvg: number | null
): { injured: boolean; missedRounds: number } {
  if (!preTradeAvg || preTradeAvg < INJURY_PRE_AVG_THRESHOLD) {
    return { injured: false, missedRounds: 0 };
  }
  let zeros = 0;
  for (let i = recentScores.length - 1; i >= 0; i--) {
    const s = recentScores[i];
    if (s === null || s === undefined || s === 0) zeros++;
    else break;
  }
  if (zeros >= INJURY_MIN_CONSECUTIVE_ZEROS) {
    return { injured: true, missedRounds: zeros };
  }
  return { injured: false, missedRounds: 0 };
}

// =====================================================================
// v2 — Performance + Availability calc on the ±100 scale
// =====================================================================
//
// For each player on a side, we compute two signed contributions:
//
//   perf  = (avg_when_played − expected_avg)
//           — what they delivered when they actually played, vs the bet
//
//   avail = expected_avg * (played / expected − 1)
//           — points-equivalent shortfall from missed availability
//           — gates on expected > 0 so a knowingly-out player has no drag
//
// Per-player combined contribution = 0.7 * perf + 0.3 * avail
// Per-side score = sum of contributions / number of players on side
// Edge (A − B) is the raw signal that drives the sigmoid into ±100.
// =====================================================================

export interface PlayerSidePerf {
  player_id: number;
  expected_avg: number;            // locked at trade time (or fallback baseline)
  expected_games: number;          // 0..4
  rounds_played: number;            // actual played rounds in the post-trade window
  avg_when_played: number | null;  // null if rounds_played == 0
}

export interface ComputeProbabilityInputs {
  roundsSince: number;
  currentRound: number;
  teamA: PlayerSidePerf[];
  teamB: PlayerSidePerf[];
  // Original PlayerPerformance kept for narrative + injury detection (read-only)
  teamAPerformance?: PlayerPerformance[];
  teamBPerformance?: PlayerPerformance[];
  aiEdge: AiEdge;
  aiMagnitude: number;
}

export interface ComputeProbabilityResult {
  /** Signed ±100 advantage to TEAM A (NOT polarity-adjusted yet — that's the caller's job). */
  advantageA: number;
  /** Legacy 0..100 probability fields, kept for callers that still consume them. */
  probA: number;
  probB: number;
  factors: TradeFactorsBreakdown;
}

interface SideAggregate {
  perfSum: number;       // sum of (avg_when_played − expected_avg) across players
  availSum: number;      // sum of availability drag (negative = drag)
  perfCount: number;     // players contributing to perf (i.e. with played data)
  availCount: number;    // players whose expected_games > 0
}

function aggregateSide(side: PlayerSidePerf[]): SideAggregate {
  const agg: SideAggregate = { perfSum: 0, availSum: 0, perfCount: 0, availCount: 0 };
  for (const p of side) {
    if (p.rounds_played > 0 && p.avg_when_played != null) {
      agg.perfSum += p.avg_when_played - p.expected_avg;
      agg.perfCount += 1;
    }
    if (p.expected_games > 0) {
      const ratio = Math.min(p.rounds_played / p.expected_games, 1);
      // avail contribution is negative when ratio < 1 (drag) and 0 when ratio = 1
      const drag = p.expected_avg * (ratio - 1);
      agg.availSum += drag;
      agg.availCount += 1;
    }
  }
  return agg;
}

export function computeProbability(inputs: ComputeProbabilityInputs): ComputeProbabilityResult {
  const { roundsSince, teamA, teamB, aiEdge, aiMagnitude } = inputs;

  const confidence = Math.min(Math.max(roundsSince, 0) / CONFIDENCE_RAMP_ROUNDS, 1.0);

  const aggA = aggregateSide(teamA);
  const aggB = aggregateSide(teamB);

  // Per-side composite (perf 70%, availability 30%). When a side has no
  // played data yet the perf component is 0 — we don't fabricate signal.
  const perfA = aggA.perfCount > 0 ? aggA.perfSum / aggA.perfCount : 0;
  const perfB = aggB.perfCount > 0 ? aggB.perfSum / aggB.perfCount : 0;
  const availA = aggA.availCount > 0 ? aggA.availSum / aggA.availCount : 0;
  const availB = aggB.availCount > 0 ? aggB.availSum / aggB.availCount : 0;

  const sideScoreA = W_PERFORMANCE * perfA + W_AVAILABILITY * availA;
  const sideScoreB = W_PERFORMANCE * perfB + W_AVAILABILITY * availB;

  // Raw edge in points-per-round to A.
  const rawEdge = sideScoreA - sideScoreB;

  // AI nudge — direct % nudge on ±100 (ramped by confidence).
  const aiPctMagnitude = magnitudeToPct(aiMagnitude);
  const aiPctNudge =
    aiEdge === 'team_a' ? +aiPctMagnitude : aiEdge === 'team_b' ? -aiPctMagnitude : 0;

  // Sigmoid into ±100. tanh keeps tails soft so a 50pt edge = ~95% advantage.
  const shaped = 100 * Math.tanh((rawEdge * confidence * SCALING_FACTOR) / 50);
  let advantageA = shaped + aiPctNudge * confidence;
  advantageA = Math.max(-95, Math.min(95, advantageA));
  // SNAP at the data layer — UI never has to re-snap.
  advantageA = snap5(advantageA);

  // Legacy 0..100 mapping for back-compat with existing UI that reads probA.
  const probA = 50 + advantageA / 2;
  const probB = 100 - probA;

  const factors: TradeFactorsBreakdown = {
    productionEdge: rawEdge,            // legacy field — repurposed as the v2 raw edge
    scarcityEdge: 0,
    projectedEdge: 0,
    aiEdge,
    aiMagnitude,
    aiPctNudge,
    confidence,
    roundsSince,
    avgA: perfA,
    avgB: perfB,
    rawEdge,
    perfVsExpectedA: aggA.perfSum,
    perfVsExpectedB: aggB.perfSum,
    availabilityDragA: availA,
    availabilityDragB: availB,
  };

  return { advantageA, probA, probB, factors };
}
