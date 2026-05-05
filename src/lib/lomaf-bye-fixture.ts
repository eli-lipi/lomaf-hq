// =====================================================================
// LOMAF head-to-head fixture for the 2026 bye window (R12–R16)
// =====================================================================
// Hardcoded from the league site's Matchups screen. Each round is a list
// of [team_id_a, team_id_b] pairs; order within a tuple is arbitrary.
//
// FINALIZED 2026-05-05 — confirmed by Lipi against the league site. The
// Byes feature treats this as authoritative and ignores `matchup_rounds`
// for the bye window so a stale DB upload can't drift these.
// =====================================================================

import { TEAMS } from './constants';
import { BYE_ROUNDS, type ByeRound } from './afl-club-byes';

export const LOMAF_BYE_FIXTURE: Record<ByeRound, [number, number][]> = {
  12: [
    [3194003, 3194002], // Littl' bit LIPI vs Mansion Mambas
    [3194001, 3194004], // Doge Bombers vs Gun M Down
    [3194005, 3194009], // South Tel Aviv Dragons vs I believe in SEANO
    [3194006, 3194008], // Melech Mitchito vs Take Me Home Country Road
    [3194007, 3194010], // Warnered613 vs Cripps Don't Lie
  ],
  13: [
    [3194003, 3194010], // Littl' bit LIPI vs Cripps Don't Lie
    [3194001, 3194005], // Doge Bombers vs South Tel Aviv Dragons
    [3194002, 3194004], // Mansion Mambas vs Gun M Down
    [3194006, 3194009], // Melech Mitchito vs I believe in SEANO
    [3194007, 3194008], // Warnered613 vs Take Me Home Country Road
  ],
  14: [
    [3194003, 3194004], // Littl' bit LIPI vs Gun M Down
    [3194001, 3194006], // Doge Bombers vs Melech Mitchito
    [3194002, 3194005], // Mansion Mambas vs South Tel Aviv Dragons
    [3194007, 3194009], // Warnered613 vs I believe in SEANO
    [3194008, 3194010], // Take Me Home Country Road vs Cripps Don't Lie
  ],
  15: [
    [3194003, 3194005], // Littl' bit LIPI vs South Tel Aviv Dragons
    [3194001, 3194007], // Doge Bombers vs Warnered613
    [3194002, 3194006], // Mansion Mambas vs Melech Mitchito
    [3194004, 3194010], // Gun M Down vs Cripps Don't Lie
    [3194008, 3194009], // Take Me Home Country Road vs I believe in SEANO
  ],
  16: [
    [3194003, 3194006], // Littl' bit LIPI vs Melech Mitchito
    [3194001, 3194008], // Doge Bombers vs Take Me Home Country Road
    [3194002, 3194007], // Mansion Mambas vs Warnered613
    [3194004, 3194005], // Gun M Down vs South Tel Aviv Dragons
    [3194009, 3194010], // I believe in SEANO vs Cripps Don't Lie
  ],
};

// Module-load sanity check: every LOMAF team must appear in exactly one
// matchup per bye round. Catches typos in the table above.
{
  const validIds = new Set(TEAMS.map((t) => t.team_id));
  for (const round of BYE_ROUNDS) {
    const seen = new Set<number>();
    for (const [a, b] of LOMAF_BYE_FIXTURE[round]) {
      for (const id of [a, b]) {
        if (!validIds.has(id)) {
          throw new Error(`LOMAF_BYE_FIXTURE R${round}: unknown team_id ${id}`);
        }
        if (seen.has(id)) {
          throw new Error(`LOMAF_BYE_FIXTURE R${round}: team_id ${id} appears twice`);
        }
        seen.add(id);
      }
    }
    if (seen.size !== TEAMS.length) {
      throw new Error(
        `LOMAF_BYE_FIXTURE R${round}: covers ${seen.size}/${TEAMS.length} teams`,
      );
    }
  }
}
