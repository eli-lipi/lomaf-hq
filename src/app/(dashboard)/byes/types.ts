import type { LeagueTeam } from '@/lib/types';
import type { ImpactGrade, ByeRule } from '@/lib/afl-club-byes';

export interface UnavailablePlayer {
  player_id: number;
  player_name: string;
  /** AFL club code (3 letters). Empty string if unknown. */
  club: string;
  /** True when the player's AFL club has a bye this round. */
  byed: boolean;
  /** True when the AFL injury feed predicts the player is out this round. */
  injured: boolean;
  /** Season-to-date average (avg_pts from `players` table). Null when unknown
   *  or the player has no games played this season. */
  avg: number | null;
}

export interface CoachRoundImpact {
  team: LeagueTeam;
  /** Size of the coach's current roster (from latest player_rounds snapshot). */
  rosterSize: number;
  /** All players unavailable this round — byed, injured, or both (deduped on player_id). */
  unavailable: UnavailablePlayer[];
  /** Combined severity grade — derived from BOTH `unavailable.length` and
   *  `pointsLost`. Crossing either threshold bumps the tier. */
  grade: ImpactGrade;
  /** Sum of `avg` across unavailable players (treats null avg as 0). */
  pointsLost: number;
}

/** Per-coach retrospective for a bye round that has already been scored. */
export interface ByeTeamRetro {
  team_id: number;
  /** Players who returned a score this round (points not null). */
  available: number;
  /** Sum of every available player's score — the full squad output. */
  totalAll: number;
  /** The counted score (best 16/17) — equals the team's matchup score_for. */
  bestN: number;
}

export interface ByeRoundRetro {
  round: number;
  rule: ByeRule;
  /** 16 for best-16 rounds, 17 for best-17 (R13). */
  minPlayable: number;
  teams: ByeTeamRetro[];
}
