/**
 * Universal Position Rubric — v11.
 *
 * Single source of truth for player tiers across the platform. Used by:
 *   - Trades (verdicts, expected-tier dropdown, win-probability inputs)
 *   - Draft Board (tier classification)
 *   - Future analytics surfaces
 *
 * Rubric values currently live as constants. The v11 spec calls for moving
 * them into Settings → editable; that page is deferred. Editing here propagates
 * everywhere.
 */

import type { NormalizedPosition } from './types';

export type Tier = 'superstar' | 'elite' | 'good' | 'average' | 'unrated';

export const TIER_ORDER: Tier[] = ['superstar', 'elite', 'good', 'average', 'unrated'];

/** Threshold (avg) for Elite, Good, Average per position. */
export const TIER_THRESHOLDS: Record<NormalizedPosition, { elite: number; good: number; average: number }> = {
  MID: { elite: 100, good: 85, average: 75 },
  DEF: { elite: 95, good: 80, average: 70 },
  RUC: { elite: 100, good: 85, average: 75 },
  FWD: { elite: 85, good: 75, average: 65 },
};

/** Superstar rank-cut per position (top-N). */
export const SUPERSTAR_TOP_N: Record<NormalizedPosition, number> = {
  MID: 7,
  DEF: 5,
  RUC: 2,
  FWD: 4,
};

/** DPP fallback order — when a player is dual-position, prefer this order. */
export const DPP_FALLBACK_ORDER: NormalizedPosition[] = ['FWD', 'DEF', 'RUC', 'MID'];

export interface TierLabel {
  tier: Tier;
  label: string;
  hint: string; // e.g. "100+ avg, top 7 MIDs"
}

/** Builds the dropdown options for a given position. */
export function tierOptionsFor(position: NormalizedPosition): TierLabel[] {
  const t = TIER_THRESHOLDS[position];
  const top = SUPERSTAR_TOP_N[position];
  return [
    { tier: 'superstar', label: 'Superstar', hint: `${t.elite}+ avg, top ${top} ${position}s` },
    { tier: 'elite', label: 'Elite', hint: `${t.elite}+ avg` },
    { tier: 'good', label: 'Good', hint: `${t.good}+ avg` },
    { tier: 'average', label: 'Average', hint: `${t.average}+ avg` },
  ];
}

/**
 * Classify a player's average into a tier (without rank info — Elite is the
 * ceiling). Used as the fallback when Superstar rank data isn't available.
 */
export function tierFromAvg(avg: number, position: NormalizedPosition): Tier {
  const t = TIER_THRESHOLDS[position];
  if (avg >= t.elite) return 'elite';
  if (avg >= t.good) return 'good';
  if (avg >= t.average) return 'average';
  return 'unrated';
}

/**
 * Classify with rank promotion to Superstar. Pass the player's current rank
 * among players at their position (1-indexed); if they're inside the top-N
 * for their position AND meet the elite threshold, they become Superstar.
 */
export function tierFromAvgAndRank(
  avg: number,
  rank: number | null,
  position: NormalizedPosition
): Tier {
  const baseTier = tierFromAvg(avg, position);
  if (baseTier === 'elite' && rank != null && rank <= SUPERSTAR_TOP_N[position]) {
    return 'superstar';
  }
  return baseTier;
}

/**
 * Map tier → numeric "expected average" used by the win-probability calc.
 * For Superstar we use the elite threshold + a small premium; the exact value
 * is less important than the comparison being tier-relative.
 */
export function tierToExpectedAvg(tier: Tier, position: NormalizedPosition): number | null {
  if (tier === 'unrated') return null;
  const t = TIER_THRESHOLDS[position];
  if (tier === 'superstar') return t.elite + 10; // small premium
  if (tier === 'elite') return t.elite;
  if (tier === 'good') return t.good;
  return t.average;
}

/**
 * v12 — Expected-average dropdown options. Returns the full 50..130 ladder
 * in 5-pt increments, partitioned into the position's tier groups so the
 * <select> can render <optgroup>s for visual separation. The ranges adapt
 * per position (a FWD's 'Good' starts at 75, a MID's at 85).
 *
 * Buckets:
 *   Below average  — under T.average
 *   Average        — T.average .. T.good - 1
 *   Good           — T.good .. T.elite - 1
 *   Elite          — T.elite .. T.elite + 14
 *   Superstar      — T.elite + 15 .. 130
 */
export interface ExpectedAvgGroup {
  label: string;
  tier: Tier;
  values: number[];
}
export function expectedAvgOptionsFor(position: NormalizedPosition): ExpectedAvgGroup[] {
  const t = TIER_THRESHOLDS[position];
  const min = 50;
  const max = 130;
  const ladder: number[] = [];
  for (let v = min; v <= max; v += 5) ladder.push(v);

  const groups: ExpectedAvgGroup[] = [];
  const below = ladder.filter((v) => v < t.average);
  if (below.length) groups.push({ label: `Below average (under ${t.average})`, tier: 'unrated', values: below });
  const avg = ladder.filter((v) => v >= t.average && v < t.good);
  if (avg.length) groups.push({ label: `Average (${t.average}–${t.good - 1})`, tier: 'average', values: avg });
  const good = ladder.filter((v) => v >= t.good && v < t.elite);
  if (good.length) groups.push({ label: `Good (${t.good}–${t.elite - 1})`, tier: 'good', values: good });
  const eliteCutoff = t.elite + 15;
  const elite = ladder.filter((v) => v >= t.elite && v < eliteCutoff);
  if (elite.length) groups.push({ label: `Elite (${t.elite}–${eliteCutoff - 1})`, tier: 'elite', values: elite });
  const superstar = ladder.filter((v) => v >= eliteCutoff);
  if (superstar.length) groups.push({ label: `Superstar (${eliteCutoff}+)`, tier: 'superstar', values: superstar });
  return groups;
}

/** Friendly tier label, capitalised. */
export function tierDisplay(tier: Tier): string {
  return tier === 'superstar'
    ? 'Superstar'
    : tier === 'elite'
      ? 'Elite'
      : tier === 'good'
        ? 'Good'
        : tier === 'average'
          ? 'Average'
          : 'Unrated';
}

/** Tier rank (lower = better). Used to compute "delivered tier vs bet tier" gap. */
export function tierRank(tier: Tier): number {
  const idx = TIER_ORDER.indexOf(tier);
  return idx >= 0 ? idx : TIER_ORDER.length;
}

/**
 * v11 verdict — tier-relative comparison.
 *
 *   Delivered ≥ 2 tiers above bet  → Crushing the bet
 *   Delivered 1 tier above bet     → Outperforming
 *   Delivered same tier as bet     → Tier-true
 *   Delivered 1 tier below bet     → Slight underperformance
 *   Delivered 2+ tiers below bet   → Bet broken — dropped N tiers
 */
export interface TierVerdict {
  level: 'crushing' | 'outperforming' | 'tier-true' | 'slight-under' | 'broken';
  text: string;
}
export function tierVerdict(deliveredTier: Tier, betTier: Tier): TierVerdict {
  const dropped = tierRank(deliveredTier) - tierRank(betTier); // +N = N tiers BELOW bet
  if (dropped <= -2) return { level: 'crushing', text: 'Crushing the bet' };
  if (dropped === -1) return { level: 'outperforming', text: 'Outperforming' };
  if (dropped === 0) return { level: 'tier-true', text: 'Tier-true' };
  if (dropped === 1) return { level: 'slight-under', text: 'Slight underperformance' };
  return { level: 'broken', text: `Bet broken — dropped ${dropped} tier${dropped === 1 ? '' : 's'}` };
}

/**
 * Resolve a (possibly DPP) raw position string to a single normalized position.
 *
 * v11 rule: when DPP, prefer the position where the player ranks HIGHEST in
 * the tier system. We don't have rank data at form-time, so we fall back to
 * the configured DPP order (FWD > DEF > RUC > MID). Once rank data is wired in
 * (Superstar job from spec §1.2) this can route through tierFromAvgAndRank
 * for both candidate positions and pick whichever produces the better tier.
 */
export function resolvePlayerPosition(rawPosition: string | null | undefined): NormalizedPosition | null {
  if (!rawPosition) return null;
  const parts = rawPosition
    .toUpperCase()
    .split(/[\/,\s]+/)
    .map((p) => p.trim())
    .filter((p): p is NormalizedPosition => (['DEF', 'MID', 'FWD', 'RUC'] as readonly string[]).includes(p));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  // DPP — pick by configured fallback order
  for (const pref of DPP_FALLBACK_ORDER) {
    if (parts.includes(pref)) return pref;
  }
  return parts[0];
}
