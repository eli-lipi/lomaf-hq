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
// Coach bye-impact grading
// =====================================================================
// Five-tier severity scale applied to each LOMAF coach's roster, given
// how many of their players are unavailable in a round (byed OR
// predicted injured) and the round's scoring rule.
//
// "Can't Field a Team" is hard-defined: roster minus unavailable players
// drops below the rule's minimum playable count (16 for best-16 rounds,
// 18 for normal rounds). Below that, severity ramps with raw count.
// =====================================================================

export type ImpactGrade = 'none' | 'low' | 'medium' | 'serious' | 'cannot-field';

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
  'serious':      { label: 'Serious Impact',     bg: '#EF4444', fg: '#FFFFFF', tint: 'rgba(239,68,68,0.10)', ordinal: 1 },
  'medium':       { label: 'Medium Impact',      bg: '#F59E0B', fg: '#1F1300', tint: 'rgba(245,158,11,0.12)', ordinal: 2 },
  'low':          { label: 'Low Impact',         bg: '#0EA5E9', fg: '#FFFFFF', tint: 'rgba(14,165,233,0.10)', ordinal: 3 },
  'none':         { label: 'No Impact',          bg: '#10B981', fg: '#FFFFFF', tint: 'rgba(16,185,129,0.08)', ordinal: 4 },
};

/** Worst → best. Useful for legends and ladders. */
export const IMPACT_GRADES_ORDERED: ImpactGrade[] = [
  'cannot-field', 'serious', 'medium', 'low', 'none',
];

export function getImpactGrade(
  unavailableCount: number,
  rosterSize: number,
  rule: ByeRule,
): ImpactGrade {
  if (unavailableCount === 0) return 'none';
  const remaining = rosterSize - unavailableCount;
  if (remaining < getMinPlayable(rule)) return 'cannot-field';
  if (unavailableCount <= 3) return 'low';
  if (unavailableCount <= 6) return 'medium';
  return 'serious';
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
