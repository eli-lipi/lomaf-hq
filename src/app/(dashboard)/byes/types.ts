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
}

export interface CoachRoundImpact {
  team: LeagueTeam;
  /** Size of the coach's current roster (from latest player_rounds snapshot). */
  rosterSize: number;
  /** All players unavailable this round — byed, injured, or both (deduped on player_id). */
  unavailable: UnavailablePlayer[];
  /** Severity grade derived from `unavailable.length`, `rosterSize`, and the round's rule. */
  grade: ImpactGrade;
}
