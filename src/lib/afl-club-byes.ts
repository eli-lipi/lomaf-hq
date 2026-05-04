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
