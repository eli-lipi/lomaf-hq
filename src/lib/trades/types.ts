// ============================================================
// Trade Tracker types
// ============================================================

export type NormalizedPosition = 'DEF' | 'MID' | 'FWD' | 'RUC';
export type AiEdge = 'team_a' | 'team_b' | 'even';

export interface Trade {
  id: string;
  team_a_id: number;
  team_a_name: string;
  team_b_id: number;
  team_b_name: string;
  round_executed: number;
  context_notes: string | null;
  screenshot_url: string | null;
  created_at: string;
}

export interface TradePlayer {
  id: string;
  trade_id: string;
  player_id: number;
  player_name: string;
  player_position: NormalizedPosition | null;
  raw_position: string | null;
  receiving_team_id: number;
  receiving_team_name: string;
  pre_trade_avg: number | null;
}

export interface TradeFactorsBreakdown {
  productionEdge: number;          // avg points/rd advantage to A (post-trade, unweighted)
  scarcityEdge: number;            // additive delta from scarcity weights
  projectedEdge: number;           // projected per-round value from injured players, A - B
  aiEdge: AiEdge;                  // from Claude
  aiMagnitude: number;             // 1-10
  aiPctNudge: number;              // final % nudge applied to A (signed)
  confidence: number;              // 0..1
  roundsSince: number;
  avgA: number;                    // raw per-round avg for A's acquired players
  avgB: number;
  rawEdge: number;                 // combined weighted edge before confidence
}

export interface TradeProbability {
  id: string;
  trade_id: string;
  round_number: number;
  team_a_probability: number;
  team_b_probability: number;
  factors: TradeFactorsBreakdown | null;
  ai_assessment: string | null;
  calculated_at: string;
}

export interface PlayerPerformance {
  player_id: number;
  player_name: string;
  receiving_team_id: number;
  receiving_team_name: string;
  position: NormalizedPosition | null;
  raw_position: string | null;
  pre_trade_avg: number | null;
  post_trade_avg: number;
  rounds_played: number;
  rounds_possible: number;
  injured: boolean;
  missed_rounds: number;
  round_scores: { round: number; points: number | null }[];
}

export interface TradeWithDetails {
  trade: Trade;
  players: TradePlayer[];
  latestProbability: TradeProbability | null;
  probabilityHistory: TradeProbability[];
  playerPerformance?: PlayerPerformance[];
}
