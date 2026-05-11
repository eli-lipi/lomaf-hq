import type { SupabaseClient } from '@supabase/supabase-js';
import { detectInjury } from './compute-probability';
import { getCurrentRound } from '@/lib/round';
import type { Trade, TradePlayer, TradeProbability } from './types';

/**
 * Shared trades-list loader. Used both by /api/trades/list (client
 * fetch path, kept for browser-back/refresh + the recommendations tab
 * polling) and by the trades page server component, so the initial
 * render arrives with HTML+data instead of an empty shell + spinner.
 */

type TradePlayerRow = Pick<
  TradePlayer,
  | 'id'
  | 'trade_id'
  | 'player_id'
  | 'player_name'
  | 'player_position'
  | 'raw_position'
  | 'receiving_team_id'
  | 'receiving_team_name'
  | 'pre_trade_avg'
>;

export interface TradesListItem {
  trade: Trade;
  players: Array<TradePlayer & { draft_position: string | null; injured: boolean }>;
  latestProbability: TradeProbability | null;
  probabilityHistory: TradeProbability[];
}

export async function loadTradesList(
  supabase: SupabaseClient
): Promise<{ trades: TradesListItem[] }> {
  // v13.2 — explicit columns on every query (was select('*')) so we don't
  // ship JSONB blobs and stale fields the list view doesn't render.
  // Round 1: trades + currentRound (independent).
  const [tradesRes, currentRound] = await Promise.all([
    supabase
      .from('trades')
      .select(
        'id, team_a_id, team_a_name, team_b_id, team_b_name, round_executed, created_at, context_notes, ai_justification, positive_team_id'
      )
      .order('created_at', { ascending: false }),
    // v12.2 — the platform's current round is the explicit ledger value
    // (round_advances), not the max round in player_rounds. Any data
    // uploaded for R+1 doesn't surface until the admin runs the round
    // advance ceremony.
    getCurrentRound(supabase),
  ]);
  if (tradesRes.error) throw tradesRes.error;
  const trades = tradesRes.data;

  const tradeIds = (trades ?? []).map((t: { id: string }) => t.id);
  if (tradeIds.length === 0) return { trades: [] };

  // Round 2: depends on tradeIds. trade_players is needed to derive
  // uniquePlayerIds for round 3. trade_probabilities + latestPlayed
  // are independent and run in parallel here.
  const [playersRes, probsRes, latestPlayedRes] = await Promise.all([
    supabase
      .from('trade_players')
      .select(
        'id, trade_id, player_id, player_name, player_position, raw_position, receiving_team_id, receiving_team_name, pre_trade_avg'
      )
      .in('trade_id', tradeIds),
    supabase
      .from('trade_probabilities')
      .select(
        'trade_id, round_number, team_a_probability, team_b_probability, advantage, calculated_at, ai_assessment'
      )
      .in('trade_id', tradeIds)
      .order('round_number', { ascending: false }),
    supabase
      .from('player_rounds')
      .select('round_number')
      .not('points', 'is', null)
      .order('round_number', { ascending: false })
      .limit(1),
  ]);

  const fallbackPlayed =
    (latestPlayedRes.data as { round_number: number }[] | null)?.[0]?.round_number ?? null;
  const maxPlayedRound = currentRound > 0 ? currentRound : fallbackPlayed;

  const players = (playersRes.data ?? []) as TradePlayerRow[];
  const uniquePlayerIds = Array.from(new Set(players.map((p) => p.player_id)));

  const playersByTrade = new Map<string, TradePlayerRow[]>();
  for (const p of players) {
    if (!playersByTrade.has(p.trade_id)) playersByTrade.set(p.trade_id, []);
    playersByTrade.get(p.trade_id)!.push(p);
  }

  const latestProbByTrade = new Map<string, TradeProbability>();
  const historyByTrade = new Map<string, TradeProbability[]>();
  for (const row of (probsRes.data ?? []) as TradeProbability[]) {
    // Skip rows pointing at unplayed rounds (the R28 ghosts).
    if (maxPlayedRound != null && row.round_number > maxPlayedRound) continue;
    if (!historyByTrade.has(row.trade_id)) historyByTrade.set(row.trade_id, []);
    historyByTrade.get(row.trade_id)!.push(row);
    // Since sorted desc, first one we see per trade is the latest
    if (!latestProbByTrade.has(row.trade_id)) latestProbByTrade.set(row.trade_id, row);
  }

  // Round 3 (parallel): draft_picks + player_rounds-for-injuries —
  // both need uniquePlayerIds and were previously sequential. Reuses
  // the latestPlayedRes round for the upper bound (was a duplicate
  // query before).
  const draftPosByPlayer = new Map<number, string>();
  const injuryByTradePlayer = new Map<string, boolean>();
  if (uniquePlayerIds.length > 0) {
    const latestRound =
      (latestPlayedRes.data as { round_number: number }[] | null)?.[0]?.round_number ?? 0;
    const [draftRes, allRoundsRes] = await Promise.all([
      supabase
        .from('draft_picks')
        .select('player_id, position')
        .in('player_id', uniquePlayerIds),
      supabase
        .from('player_rounds')
        .select('player_id, team_id, round_number, points')
        .in('player_id', uniquePlayerIds)
        .lte('round_number', latestRound),
    ]);

    for (const d of (draftRes.data ?? []) as { player_id: number; position: string | null }[]) {
      if (d.position) draftPosByPlayer.set(d.player_id, d.position);
    }

    // For each trade × player, filter to post-trade rounds on receiving team.
    const allRounds = (allRoundsRes.data ?? []) as Array<{
      player_id: number;
      team_id: number;
      round_number: number;
      points: number | null;
    }>;
    for (const t of (trades ?? []) as Array<{ id: string; round_executed: number }>) {
      const tradePlayers = playersByTrade.get(t.id) ?? [];
      for (const tp of tradePlayers) {
        const scores = allRounds
          .filter(
            (r) =>
              r.player_id === tp.player_id &&
              r.team_id === tp.receiving_team_id &&
              r.round_number > t.round_executed
          )
          .sort((a, b) => a.round_number - b.round_number)
          .map((r) => r.points);
        const injury = detectInjury(scores, tp.pre_trade_avg);
        injuryByTradePlayer.set(`${t.id}-${tp.player_id}`, injury.injured);
      }
    }
  }

  const result: TradesListItem[] = ((trades ?? []) as Trade[]).map((t) => ({
    trade: t,
    players: (playersByTrade.get(t.id) ?? []).map((p) => ({
      ...(p as TradePlayer),
      draft_position: draftPosByPlayer.get(p.player_id) ?? null,
      injured: injuryByTradePlayer.get(`${t.id}-${p.player_id}`) ?? false,
    })),
    latestProbability: latestProbByTrade.get(t.id) ?? null,
    probabilityHistory: (historyByTrade.get(t.id) ?? []).slice().reverse(),
  }));

  return { trades: result };
}
