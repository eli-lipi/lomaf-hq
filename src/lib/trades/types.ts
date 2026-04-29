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
  // v2 — frozen at trade execution
  positive_team_id: number | null;
  negative_team_id: number | null;
  team_a_ladder_at_trade: number | null;
  team_b_ladder_at_trade: number | null;
  // v12 — AI-written justification of WHY the trade made sense (locked
  // at execution time, regenerated only on edit). Format: 'headline\n-
  // bullet\n- bullet'. Null on legacy trades that haven't been edited
  // since v12 shipped, or when AI is unavailable.
  ai_justification?: string | null;
}

export interface TradePlayer {
  id: string;
  trade_id: string;
  player_id: number;
  player_name: string;
  player_position: NormalizedPosition | null;
  raw_position: string | null;
  // v12 — locked draft position (DEF/MID/FWD/RUC, possibly DPP). Pulled
  // from draft_picks at trade time so the player's league identity travels
  // with the trade row even after they're dropped/picked up.
  draft_position?: string | null;
  receiving_team_id: number;
  receiving_team_name: string;
  pre_trade_avg: number | null;
  // v2 — locked at trade execution (legacy fields, kept for back-compat)
  expected_avg: number | null;
  expected_avg_source: 'manual' | 'auto' | null;
  expected_games: number | null;       // 0..4, default 4 (legacy v2 scale)

  // v11 — tier system + per-player context. Nullable for un-edited legacy
  // trades; populated when admin uses the Edit flow.
  expected_tier?: 'superstar' | 'elite' | 'good' | 'average' | 'unrated' | null;
  expected_games_remaining?: number | null;   // raw games over the post-trade window
  expected_games_max?: number | null;         // max-available at trade execution
  player_context?: string | null;
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
  // v2 — availability adjustment + per-side performance vs expected
  perfVsExpectedA?: number;        // sum of (actual - expected) for side A's players
  perfVsExpectedB?: number;
  availabilityDragA?: number;      // 0..1 — how much of A's expected output went missing
  availabilityDragB?: number;
}

export interface TradeProbability {
  id: string;
  trade_id: string;
  round_number: number;
  team_a_probability: number;
  team_b_probability: number;
  // v2 — signed advantage on the ±100 scale, polarized to positive_team_id.
  // +N = positive_team winning the trade by N percentage points.
  advantage: number | null;
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
  draft_position: string | null; // from draft_picks — stable, never 'BN'
  pre_trade_avg: number | null;
  post_trade_avg: number;
  rounds_played: number;
  rounds_possible: number;
  injured: boolean;
  missed_rounds: number;
  round_scores: { round: number; points: number | null }[];
  // Pre-trade rounds for this player (any team). Lets the UI render the
  // before/after timeline side-by-side. May be empty if the trade was
  // executed at R0.
  pre_trade_round_scores?: { round: number; points: number | null }[];
}

export interface TradeWithDetails {
  trade: Trade;
  players: TradePlayer[];
  latestProbability: TradeProbability | null;
  probabilityHistory: TradeProbability[];
  playerPerformance?: PlayerPerformance[];
}
