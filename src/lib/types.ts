// ============================================================
// Database table types (match Supabase schema exactly)
// ============================================================

export interface CsvUpload {
  id: string;
  round_number: number;
  upload_type: 'lineups' | 'teams' | 'points_grid' | 'draft' | 'matchups';
  uploaded_at: string;
  raw_data: Record<string, unknown>[];
}

export interface TeamSnapshot {
  id: string;
  round_number: number;
  team_id: number;
  team_name: string;
  wins: number;
  losses: number;
  ties: number;
  pts_for: number;
  pts_against: number;
  pct: number;
  league_rank: number;
  def_total: number;
  mid_total: number;
  fwd_total: number;
  ruc_total: number;
  utl_total: number;
  def_rank: number;
  mid_rank: number;
  fwd_rank: number;
  ruc_rank: number;
  utl_rank: number;
  def_season_rank: number;
  mid_season_rank: number;
  fwd_season_rank: number;
  ruc_season_rank: number;
  utl_season_rank: number;
  created_at: string;
}

export interface DraftPick {
  id: string;
  round: number;
  round_pick: number;
  overall_pick: number;
  team_name: string;
  team_id: number;
  player_name: string;
  player_id: number;
  drafted_at: string | null;
  draft_method: string | null;
  position: string | null;
}

export interface PlayerRound {
  id: string;
  round_number: number;
  team_id: number;
  team_name: string;
  player_id: number;
  player_name: string;
  pos: string;
  is_emg: boolean;
  is_scoring: boolean;
  points: number | null;
}

export interface PwrnkgsRound {
  id: string;
  round_number: number;
  theme: string | null;
  preview_text: string | null;
  week_ahead_text: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  created_at: string;
}

export interface PwrnkgsRanking {
  id: string;
  round_id: string;
  round_number: number;
  team_id: number;
  team_name: string;
  ranking: number;
  previous_ranking: number | null;
  writeup: string;
  created_at: string;
}

// ============================================================
// App-level types
// ============================================================

export interface LeagueTeam {
  team_name: string;
  team_id: number;
  coach: string;
  coach_photo_key: string | string[];
  is_co_coached?: boolean;
}

export interface RankingWithMovement extends PwrnkgsRanking {
  movement: number | null; // positive = moved up, negative = moved down
  movement_label: string; // "↑2", "↓3", "—", "NEW"
  snapshot?: TeamSnapshot;
}

export interface SlideData {
  slideIndex: number;
  type: 'preview' | 'team' | 'summary';
  roundNumber: number;
  round: PwrnkgsRound;
  ranking?: RankingWithMovement;
  team?: LeagueTeam;
  allRankings?: RankingWithMovement[];
  sparklineData?: number[];
}

export interface MatchupRound {
  id: string;
  round_number: number;
  team_id: number;
  team_name: string;
  score_for: number;
  score_against: number;
  win: boolean;
  loss: boolean;
  tie: boolean;
  opp_name: string;
  opp_id: number;
  fixture_id: number;
  created_at: string;
}

export interface ScoreAdjustment {
  id: string;
  round_number: number;
  team_id: number;
  team_name: string;
  correct_score: number;
  lineup_score: number;
  adjustment: number;
  source: 'auto' | 'manual';
  assigned_line: string | null;
  note: string | null;
  status: 'unconfirmed' | 'confirmed';
  created_at: string;
  updated_at: string;
}

export type LineGroup = 'DEF' | 'MID' | 'FWD' | 'RUC' | 'UTL';
export type LineupSlot = 'DEF' | 'MID' | 'FWD' | 'RUC' | 'UTL' | 'BN';
