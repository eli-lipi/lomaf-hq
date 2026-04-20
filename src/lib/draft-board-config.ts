import { supabase } from './supabase';

export interface Tier {
  elite: number;
  good: number;
  avg: number;
}

export interface RoundBracket {
  from: number;
  to: number;
  scale_pct: number;
}

export interface AvailabilityThresholds {
  bust_below_pct: number;
  cap_fair_below_pct: number;
  demote_below_pct: number;
}

export interface DraftBoardConfig {
  benchmarks: { MID: Tier; DEF: Tier; FWD: Tier; RUC: Tier };
  round_brackets: RoundBracket[];
  availability: AvailabilityThresholds;
}

export const DEFAULT_CONFIG: DraftBoardConfig = {
  benchmarks: {
    MID: { elite: 100, good: 85, avg: 75 },
    DEF: { elite: 95, good: 80, avg: 70 },
    FWD: { elite: 85, good: 75, avg: 65 },
    RUC: { elite: 95, good: 80, avg: 70 },
  },
  round_brackets: [
    { from: 1, to: 2, scale_pct: 6 },
    { from: 3, to: 4, scale_pct: 3 },
    { from: 5, to: 10, scale_pct: 0 },
    { from: 11, to: 15, scale_pct: -5 },
    { from: 16, to: 999, scale_pct: -10 },
  ],
  availability: {
    bust_below_pct: 30,
    cap_fair_below_pct: 50,
    demote_below_pct: 75,
  },
};

export async function loadDraftBoardConfig(): Promise<DraftBoardConfig> {
  const { data, error } = await supabase
    .from('draft_board_config')
    .select('config')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data?.config) return DEFAULT_CONFIG;
  return data.config as DraftBoardConfig;
}

export async function saveDraftBoardConfig(config: DraftBoardConfig): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('draft_board_config')
    .upsert({ id: 1, config, updated_at: new Date().toISOString() });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Returns a multiplier for a given round, e.g. 1.06 for +6%.
export function getRoundScale(round: number, brackets: RoundBracket[]): number {
  const bracket = brackets.find((b) => round >= b.from && round <= b.to);
  const pct = bracket?.scale_pct ?? 0;
  return 1 + pct / 100;
}
