// =====================================================================
// AFL club bye schedule — 2026 season
// =====================================================================
// The AFL bye block runs R12–R16. Each of the 18 AFL clubs has exactly
// one bye in this window. LOMAF scoring rules:
//   - 2-bye round (R13)            → play normally
//   - 4-bye round (R12, R14–R16)   → play "best 16" (top 16 scores
//                                    from each coach's full list,
//                                    no positions / bench / emg)
//
// Data is static for 2026 — taken directly from the AFL.com.au fixture.
// If we need admin editability per season, promote this to a Supabase
// table later (table shape: `afl_club_byes(season, round_number, club_code)`).
// =====================================================================

import { ALL_CLUB_CODES } from './afl-clubs';

export const BYE_ROUNDS = [12, 13, 14, 15, 16] as const;
export type ByeRound = (typeof BYE_ROUNDS)[number];

export const AFL_CLUB_BYES: Record<ByeRound, string[]> = {
  12: ['ADE', 'GCS', 'NTH', 'PTA'],
  13: ['GWS', 'RIC'],
  14: ['COL', 'CAR', 'HAW', 'FRE'],
  15: ['BRL', 'ESS', 'SYD', 'WCE'],
  16: ['WBD', 'GEE', 'STK', 'MEL'],
};

export type ByeRule = 'normal' | 'best-16';

/** 2-bye rounds → play normally; 4-bye rounds → best 16. */
export function getByeRule(round: ByeRound): ByeRule {
  return AFL_CLUB_BYES[round].length === 2 ? 'normal' : 'best-16';
}

/** Minimum playable squad size for the round's scoring rule.
 *  Normal: 18 scoring positions (5 DEF + 7 MID + 4 FWD + 1 RUC + 1 UTL).
 *  Best-16: top 16 scores from the full roster — no positions / bench. */
export function getMinPlayable(rule: ByeRule): number {
  return rule === 'best-16' ? 16 : 18;
}

// =====================================================================
// Coach bye-impact grading — single combined grade
// =====================================================================
// One five-tier severity scale per (coach, round) that takes BOTH the
// raw count of unavailable players AND the sum of their season-avg
// points. Crossing EITHER threshold bumps you up to the next tier —
// you're as bad as your worst lens.
//
// Thresholds:
//   No Impact:           0 players      AND  0 pts
//   Low Impact:          1–3 players    OR   1–249 pts
//   Medium Impact:       4–6 players    OR   250–499 pts
//   High Impact:         7+ (fieldable) OR   500–699 pts
//   Can't Field a Team:  roster − out < scoring min  OR  ≥700 pts
// =====================================================================

export type ImpactGrade = 'none' | 'low' | 'medium' | 'high' | 'cannot-field';

export interface ImpactMeta {
  label: string;
  /** Pill background. */
  bg: string;
  /** Pill text on `bg`. */
  fg: string;
  /** Soft tint used for row accent / hover. */
  tint: string;
  /** Worst-first ordinal for sorting (0 = worst). */
  ordinal: number;
}

export const IMPACT_META: Record<ImpactGrade, ImpactMeta> = {
  'cannot-field': { label: "Can't Field a Team", bg: '#7F1D1D', fg: '#FFFFFF', tint: 'rgba(127,29,29,0.10)', ordinal: 0 },
  'high':         { label: 'High Impact',        bg: '#EF4444', fg: '#FFFFFF', tint: 'rgba(239,68,68,0.10)', ordinal: 1 },
  'medium':       { label: 'Medium Impact',      bg: '#F59E0B', fg: '#1F1300', tint: 'rgba(245,158,11,0.12)', ordinal: 2 },
  'low':          { label: 'Low Impact',         bg: '#0EA5E9', fg: '#FFFFFF', tint: 'rgba(14,165,233,0.10)', ordinal: 3 },
  'none':         { label: 'No Impact',          bg: '#10B981', fg: '#FFFFFF', tint: 'rgba(16,185,129,0.08)', ordinal: 4 },
};

/** Worst → best. Useful for legends and ladders. */
export const IMPACT_GRADES_ORDERED: ImpactGrade[] = [
  'cannot-field', 'high', 'medium', 'low', 'none',
];

/** Avg threshold above which an unavailable player gets a star indicator
 *  in expanded lists. AFL Fantasy treats 100+ as the "century" tier. */
export const STAR_AVG_THRESHOLD = 100;

/** Count-only tier — internal helper, exposed for documentation/tests. */
function countTier(
  unavailableCount: number,
  rosterSize: number,
  rule: ByeRule,
): ImpactGrade {
  if (unavailableCount === 0) return 'none';
  if (rosterSize - unavailableCount < getMinPlayable(rule)) return 'cannot-field';
  if (unavailableCount <= 3) return 'low';
  if (unavailableCount <= 6) return 'medium';
  return 'high'; // 7+ but still fieldable
}

/** Points-only tier — internal helper. */
function pointsTier(pointsLost: number): ImpactGrade {
  if (pointsLost <= 0) return 'none';
  if (pointsLost >= 700) return 'cannot-field';
  if (pointsLost <= 249) return 'low';
  if (pointsLost <= 499) return 'medium';
  return 'high'; // 500–699
}

function moreSevere(a: ImpactGrade, b: ImpactGrade): ImpactGrade {
  // Lower ordinal = more severe (cannot-field=0 is worst).
  return IMPACT_META[a].ordinal <= IMPACT_META[b].ordinal ? a : b;
}

/** Combined grade — "you're as bad as your worst lens". */
export function getImpactGrade(
  unavailableCount: number,
  rosterSize: number,
  rule: ByeRule,
  pointsLost: number,
): ImpactGrade {
  return moreSevere(
    countTier(unavailableCount, rosterSize, rule),
    pointsTier(pointsLost),
  );
}

/** Returns the round in which an AFL club byes, or null if not in the bye window. */
export function getByeRoundForClub(code: string): ByeRound | null {
  for (const round of BYE_ROUNDS) {
    if (AFL_CLUB_BYES[round].includes(code)) return round;
  }
  return null;
}

// Build-time sanity check: every AFL club must have exactly one bye.
// Throws at module load if the fixture is mis-entered.
{
  const seen = new Set<string>();
  for (const round of BYE_ROUNDS) {
    for (const code of AFL_CLUB_BYES[round]) {
      if (seen.has(code)) {
        throw new Error(`AFL_CLUB_BYES misconfigured: ${code} appears in multiple rounds`);
      }
      seen.add(code);
    }
  }
  for (const code of ALL_CLUB_CODES) {
    if (!seen.has(code)) {
      throw new Error(`AFL_CLUB_BYES misconfigured: ${code} has no bye assigned`);
    }
  }
}
