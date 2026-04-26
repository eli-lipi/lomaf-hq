/**
 * Auto-derivation logic for per-player Expected Average and Expected Games
 * Played. Locked at trade execution — the bet being judged.
 */

import { cleanPositionDisplay, normalizePosition } from './positions';
import type { NormalizedPosition } from './types';

// Tunable constants — tweak here, not in calling sites.
export const FORM_BLEND_TIER = 0.6;     // 60% tier baseline
export const FORM_BLEND_RECENT = 0.4;    // 40% last-3-round average
export const RECENT_FORM_WINDOW = 3;
export const REQUIRED_PRIOR_ROUNDS = 3;  // below this we skip the form blend
export const LONG_INJURY_DNP_THRESHOLD = 4;

// Position-baseline averages — these are LOMAF-league rule-of-thumb tiers
// for "what an average starter at this position looks like." Tier mapping
// can be swapped in later (Draft Board pulls deeper data) but this is a
// reasonable v1 fallback.
const TIER_BASELINE: Record<NormalizedPosition, number> = {
  DEF: 75,
  MID: 90,
  FWD: 75,
  RUC: 85,
};

export interface ExpectedAvgResult {
  expected_avg: number;
  source: 'manual' | 'auto';
  // Methodology breakdown for the tooltip
  methodology: {
    tier_baseline: number;
    last_n_avg: number | null;
    blend_weight_tier: number;
    blend_weight_recent: number;
    flag: 'tier-only-rookie' | 'tier-only-injury' | 'blended' | null;
  };
}

/** Auto-derive expected_avg from prior round scores + position tier. */
export function autoExpectedAvg(args: {
  raw_position: string | null;
  draft_position: string | null;
  prior_round_scores: { round: number; points: number | null }[];
}): ExpectedAvgResult {
  const cleaned =
    cleanPositionDisplay(args.draft_position) ?? cleanPositionDisplay(args.raw_position);
  const pos = normalizePosition(cleaned ?? '') ?? 'MID';
  const tierBaseline = TIER_BASELINE[pos];

  const sorted = [...args.prior_round_scores].sort((a, b) => b.round - a.round);
  const playedScores = sorted.filter((s) => s.points != null && s.points > 0);
  const dnpCount = sorted.filter((s) => s.points == null || s.points === 0).length;

  // Edge case: long-injury return — recent data is misleading
  if (dnpCount >= LONG_INJURY_DNP_THRESHOLD) {
    return {
      expected_avg: tierBaseline,
      source: 'auto',
      methodology: {
        tier_baseline: tierBaseline,
        last_n_avg: null,
        blend_weight_tier: 1,
        blend_weight_recent: 0,
        flag: 'tier-only-injury',
      },
    };
  }

  // Edge case: rookie / not enough data
  if (playedScores.length < REQUIRED_PRIOR_ROUNDS) {
    return {
      expected_avg: tierBaseline,
      source: 'auto',
      methodology: {
        tier_baseline: tierBaseline,
        last_n_avg: null,
        blend_weight_tier: 1,
        blend_weight_recent: 0,
        flag: 'tier-only-rookie',
      },
    };
  }

  // Form blend
  const recent = playedScores.slice(0, RECENT_FORM_WINDOW);
  const recentAvg =
    recent.reduce((sum, s) => sum + (s.points ?? 0), 0) / recent.length;
  const blended =
    FORM_BLEND_TIER * tierBaseline + FORM_BLEND_RECENT * recentAvg;

  return {
    expected_avg: Math.round(blended * 10) / 10,
    source: 'auto',
    methodology: {
      tier_baseline: tierBaseline,
      last_n_avg: Math.round(recentAvg * 10) / 10,
      blend_weight_tier: FORM_BLEND_TIER,
      blend_weight_recent: FORM_BLEND_RECENT,
      flag: 'blended',
    },
  };
}

/** Default expected_games_in_window. Reduces by detected unavailability. */
export function autoExpectedGames(args: {
  prior_round_scores: { round: number; points: number | null }[];
  upcoming_byes_in_window?: number; // count of byes in the next 4 rounds
}): number {
  // Default full availability for the 4-round window
  let games = 4;

  // Penalize "managed" / "late out" patterns: count recent DNPs/zeros
  const sorted = [...args.prior_round_scores].sort((a, b) => b.round - a.round);
  const recent = sorted.slice(0, 4);
  const recentDnps = recent.filter((s) => s.points == null || s.points === 0).length;
  if (recentDnps === 1) games -= 0.5;       // managed-load type pattern
  else if (recentDnps === 2) games -= 1;     // injury-ish
  else if (recentDnps >= 3) games -= 2;      // likely out

  if (args.upcoming_byes_in_window) {
    games -= args.upcoming_byes_in_window;
  }

  return Math.max(0, Math.min(4, games));
}
