import type { LeagueTeam } from '@/lib/types';
import type { ImpactGrade } from '@/lib/afl-club-byes';

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
