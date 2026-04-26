import type {
  AiEdge,
  NormalizedPosition,
  TradeFactorsBreakdown,
  PlayerPerformance,
} from './types';
import { getScarcityMultiplier } from './positions';

// --- Tunable constants ---
export const SCALING_FACTOR = 0.8;           // sigmoid scaling — calibrated so ~30 pts/rd edge → ~75/25 at full confidence
export const CONFIDENCE_RAMP_ROUNDS = 8;     // rounds to reach full confidence
export const INJURY_MIN_CONSECUTIVE_ZEROS = 2;
export const INJURY_PRE_AVG_THRESHOLD = 60;
export const INJURY_RETURN_PROBABILITY = 0.7;
export const TOTAL_REGULAR_SEASON_ROUNDS = 23; // spec: finals start R21? code says R23 total

// Weights per spec §4
export const W_PRODUCTION = 0.40;
export const W_SCARCITY = 0.15;
export const W_PROJECTED = 0.20;
// Factor 4 (AI) = 15% applied as a direct % nudge
// Factor 5 (confidence) = 10% — applied multiplicatively to entire edge

export const FINALS_START_ROUND = 21;

// --- Helpers ---

export function magnitudeToPct(magnitude: number): number {
  if (magnitude <= 0) return 0;
  if (magnitude <= 3) return 2;
  if (magnitude <= 6) return 5;
  return 8;
}

/**
 * Detect likely-injured status for a player.
 * Flag: >=2 consecutive recent zero/null rounds AND pre_trade_avg >= 60.
 * Auto-clears when player scores > 0 after being flagged (by re-running on updated data).
 */
export function detectInjury(
  recentScores: (number | null)[],
  preTradeAvg: number | null
): { injured: boolean; missedRounds: number } {
  if (!preTradeAvg || preTradeAvg < INJURY_PRE_AVG_THRESHOLD) {
    return { injured: false, missedRounds: 0 };
  }
  // Walk from the latest backward, counting consecutive zeros/nulls
  let zeros = 0;
  for (let i = recentScores.length - 1; i >= 0; i--) {
    const s = recentScores[i];
    if (s === null || s === undefined || s === 0) {
      zeros++;
    } else {
      break;
    }
  }
  if (zeros >= INJURY_MIN_CONSECUTIVE_ZEROS) {
    return { injured: true, missedRounds: zeros };
  }
  return { injured: false, missedRounds: 0 };
}

// --- Core ---

export interface ComputeProbabilityInputs {
  roundsSince: number;                       // currentRound - roundExecuted
  currentRound: number;                      // the round we're computing for
  teamAPerformance: PlayerPerformance[];     // players Team A RECEIVED
  teamBPerformance: PlayerPerformance[];     // players Team B RECEIVED
  aiEdge: AiEdge;
  aiMagnitude: number;                       // 1..10
}

export interface ComputeProbabilityResult {
  probA: number;
  probB: number;
  factors: TradeFactorsBreakdown;
}

/**
 * Sum of per-round post-trade points for a set of players, divided by roundsSince.
 * Nulls count as 0 — per spec §4 Factor 1, "if a player scores 0 (injured/bye), that counts".
 */
function rawAvgPerRound(players: PlayerPerformance[], roundsSince: number): number {
  if (roundsSince <= 0) return 0;
  // Total points per round across all players (summed), averaged across the roundsSince window
  let total = 0;
  for (const p of players) {
    for (const rs of p.round_scores) {
      total += rs.points ?? 0;
    }
  }
  return total / roundsSince;
}

/**
 * Scarcity-weighted per-round average.
 */
function scarcityWeightedAvgPerRound(players: PlayerPerformance[], roundsSince: number): number {
  if (roundsSince <= 0) return 0;
  let total = 0;
  for (const p of players) {
    const mult = getScarcityMultiplier(p.position as NormalizedPosition | null);
    for (const rs of p.round_scores) {
      total += (rs.points ?? 0) * mult;
    }
  }
  return total / roundsSince;
}

/**
 * For each injured player, estimate per-round projected value on return:
 *   pre_trade_avg * return_probability, weighted by remaining_rounds share.
 * We return a PER-ROUND figure (already normalized) so it sums naturally with production.
 */
function projectedPerRound(players: PlayerPerformance[], currentRound: number): number {
  const remaining = Math.max(TOTAL_REGULAR_SEASON_ROUNDS - currentRound, 0);
  if (remaining <= 0) return 0;

  let projected = 0;
  for (const p of players) {
    if (!p.injured || !p.pre_trade_avg) continue;
    // Assume the player misses the rest of the CURRENT observation window but
    // returns going forward. Per-round "unseen" value that partially offsets
    // the cost of the 0s we've already counted.
    projected += p.pre_trade_avg * INJURY_RETURN_PROBABILITY * (remaining / TOTAL_REGULAR_SEASON_ROUNDS);
  }
  return projected;
}

export function computeProbability(inputs: ComputeProbabilityInputs): ComputeProbabilityResult {
  const { roundsSince, currentRound, teamAPerformance, teamBPerformance, aiEdge, aiMagnitude } = inputs;

  const confidence = Math.min(Math.max(roundsSince, 0) / CONFIDENCE_RAMP_ROUNDS, 1.0);

  // Factor 1: raw production
  const avgA = rawAvgPerRound(teamAPerformance, roundsSince);
  const avgB = rawAvgPerRound(teamBPerformance, roundsSince);
  const productionEdge = avgA - avgB;

  // Factor 2: scarcity edge (additive delta vs raw)
  const adjA = scarcityWeightedAvgPerRound(teamAPerformance, roundsSince);
  const adjB = scarcityWeightedAvgPerRound(teamBPerformance, roundsSince);
  const scarcityEdge = adjA - adjB - productionEdge;

  // Factor 3: projected value from injured players
  const projA = projectedPerRound(teamAPerformance, currentRound);
  const projB = projectedPerRound(teamBPerformance, currentRound);
  const projectedEdge = projA - projB;

  // Factor 4: AI nudge (as direct % points)
  const aiPctMagnitude = magnitudeToPct(aiMagnitude);
  const aiPctNudge =
    aiEdge === 'team_a' ? +aiPctMagnitude : aiEdge === 'team_b' ? -aiPctMagnitude : 0;

  // Combine the production-like factors (all in fantasy-points-per-round scale)
  const rawEdge =
    productionEdge * W_PRODUCTION +
    scarcityEdge * W_SCARCITY +
    projectedEdge * W_PROJECTED;

  // Apply confidence & scaling → sigmoid-ish via tanh, scaled to ±50% theoretical
  const shaped = 50 * Math.tanh((rawEdge * confidence * SCALING_FACTOR) / 30);

  let probA = 50 + shaped + aiPctNudge * confidence;

  // Clamp
  probA = Math.max(5, Math.min(95, probA));
  // Snap to 5% increments — 51% vs 49% reads as noise; 55% vs 45% reads as
  // a real edge. Per LOMAF call: "don't do 51% vs 49%, it's too insignificant".
  probA = Math.round(probA / 5) * 5;
  const probB = 100 - probA;

  const factors: TradeFactorsBreakdown = {
    productionEdge,
    scarcityEdge,
    projectedEdge,
    aiEdge,
    aiMagnitude,
    aiPctNudge,
    confidence,
    roundsSince,
    avgA,
    avgB,
    rawEdge,
  };

  return { probA, probB, factors };
}
