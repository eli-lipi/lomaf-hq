/**
 * Trades — display & math helpers for the ±100 advantage scale.
 *
 * Single source of truth: snap once at the data layer, render snapped values
 * everywhere. The UI never re-snaps — it just trusts these helpers.
 */

/** Snap a percentage value to the nearest 5. Works for negative numbers too. */
export function snap5(pct: number): number {
  return Math.round(pct / 5) * 5;
}

/**
 * Convert a 0..100 probability for team A into the signed ±100 advantage
 * relative to a chosen "positive" team. 50 → 0; 75 → +50 if A is positive,
 * −50 if B is positive.
 */
export function toAdvantage(
  probA: number,
  positiveTeamId: number | null,
  teamAId: number,
  teamBId: number
): number {
  // Edge to A on a ±100 scale: 50 → 0, 100 → +100, 0 → −100.
  const aEdge = (probA - 50) * 2;
  if (positiveTeamId === teamBId) return -aEdge;
  // Default to A as positive when polarity isn't set.
  void teamAId;
  return aEdge;
}

/** Verdict thresholds for the v2 ±100 scale. */
export type VerdictLevel = 'flip' | 'slight' | 'edge' | 'big' | 'robbery';
export interface Verdict {
  level: VerdictLevel;
  text: string;
  isFlip: boolean;
}

export function verdictFor(advantage: number, positiveTeamName: string, negativeTeamName: string): Verdict {
  const abs = Math.abs(advantage);
  const winner = advantage >= 0 ? positiveTeamName : negativeTeamName;
  if (abs <= 10) return { level: 'flip', text: 'Coin flip', isFlip: true };
  if (abs <= 30) return { level: 'slight', text: `Slight edge — ${winner}`, isFlip: false };
  if (abs <= 55) return { level: 'edge', text: `Edge — ${winner}`, isFlip: false };
  if (abs <= 80) return { level: 'big', text: `Big edge — ${winner}`, isFlip: false };
  return { level: 'robbery', text: `Robbery — ${winner}`, isFlip: false };
}

/** Per-player verdict (resolution criteria) thresholds. */
export type PlayerVerdict =
  | 'crushing'
  | 'outperforming'
  | 'tracking'
  | 'slight-under'
  | 'broken'
  | 'avail-drag'
  | 'pending';

export interface PlayerVerdictResult {
  level: PlayerVerdict;
  text: string;
}

export function playerVerdictFor(
  avgSinceTrade: number | null,
  expectedAvg: number | null,
  expectedGames: number | null,
  actualGames: number
): PlayerVerdictResult {
  // Availability drag check first — it overrides perf when severe
  if (
    expectedGames != null &&
    expectedGames >= 1 &&
    actualGames / expectedGames < 0.5 &&
    actualGames < expectedGames
  ) {
    return {
      level: 'avail-drag',
      text: `Availability drag — missed ${Math.round(expectedGames - actualGames)} of ${Math.round(expectedGames)} expected games`,
    };
  }
  if (avgSinceTrade == null || expectedAvg == null) {
    return { level: 'pending', text: 'Pending — no post-trade data yet' };
  }
  const delta = avgSinceTrade - expectedAvg;
  if (delta > 10) return { level: 'crushing', text: 'Crushing the bet' };
  if (delta >= 5) return { level: 'outperforming', text: 'Outperforming' };
  if (delta >= -5) return { level: 'tracking', text: 'Tracking expectation' };
  if (delta >= -10) return { level: 'slight-under', text: 'Slight underperformance' };
  return { level: 'broken', text: 'Bet broken' };
}
