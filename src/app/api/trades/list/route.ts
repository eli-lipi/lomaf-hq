import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { detectInjury } from '@/lib/trades/compute-probability';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface TradePlayerRow {
  id: string;
  trade_id: string;
  player_id: number;
  player_name: string;
  player_position: string | null;
  raw_position: string | null;
  receiving_team_id: number;
  receiving_team_name: string;
  pre_trade_avg: number | null;
}

export async function GET() {
  try {
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const tradeIds = (trades ?? []).map((t) => t.id);
    if (tradeIds.length === 0) return NextResponse.json({ trades: [] });

    const [playersRes, probsRes, latestPlayedRes] = await Promise.all([
      supabase.from('trade_players').select('*').in('trade_id', tradeIds),
      supabase
        .from('trade_probabilities')
        .select('*')
        .in('trade_id', tradeIds)
        .order('round_number', { ascending: false }),
      // Determine the MAX round with actual played scores. Used to ignore
      // stale future-round trade_probabilities rows (R28 ghosts from the
      // earlier recalc bug). The DB self-heals on next CSV upload, but
      // we filter on read so the UI never shows the bogus round labels.
      supabase
        .from('player_rounds')
        .select('round_number')
        .not('points', 'is', null)
        .order('round_number', { ascending: false })
        .limit(1),
    ]);

    const maxPlayedRound =
      (latestPlayedRes.data as { round_number: number }[] | null)?.[0]?.round_number ?? null;

    const players = (playersRes.data ?? []) as TradePlayerRow[];

    const playersByTrade = new Map<string, TradePlayerRow[]>();
    for (const p of players) {
      if (!playersByTrade.has(p.trade_id)) playersByTrade.set(p.trade_id, []);
      playersByTrade.get(p.trade_id)!.push(p);
    }

    const latestProbByTrade = new Map<string, unknown>();
    const historyByTrade = new Map<string, unknown[]>();
    for (const row of probsRes.data ?? []) {
      // Skip rows pointing at unplayed rounds (the R28 ghosts).
      if (maxPlayedRound != null && row.round_number > maxPlayedRound) continue;
      if (!historyByTrade.has(row.trade_id)) historyByTrade.set(row.trade_id, []);
      historyByTrade.get(row.trade_id)!.push(row);
      // Since sorted desc, first one we see per trade is the latest
      if (!latestProbByTrade.has(row.trade_id)) latestProbByTrade.set(row.trade_id, row);
    }

    // Draft positions (stable, never 'BN') for every player across all trades
    const uniquePlayerIds = Array.from(new Set(players.map((p) => p.player_id)));
    const draftPosByPlayer = new Map<number, string>();
    if (uniquePlayerIds.length > 0) {
      const { data: draftRows } = await supabase
        .from('draft_picks')
        .select('player_id, position')
        .in('player_id', uniquePlayerIds);
      for (const d of (draftRows ?? []) as { player_id: number; position: string | null }[]) {
        if (d.position) draftPosByPlayer.set(d.player_id, d.position);
      }
    }

    // Injury status per (trade_id, player_id) — compute per-player using the
    // same detectInjury helper as the detail view. Only looks at post-trade
    // rounds on the player's receiving team.
    const injuryByTradePlayer = new Map<string, boolean>();
    if (uniquePlayerIds.length > 0) {
      // Find max round with player_rounds data
      const { data: latest } = await supabase
        .from('player_rounds')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1);
      const latestRound = latest?.[0]?.round_number ?? 0;

      // Fetch all post-trade rounds for all traded players
      const { data: allRounds } = await supabase
        .from('player_rounds')
        .select('player_id, team_id, round_number, points')
        .in('player_id', uniquePlayerIds)
        .lte('round_number', latestRound);

      // For each trade × player, filter to post-trade rounds on receiving team
      for (const t of trades ?? []) {
        const tradePlayers = playersByTrade.get(t.id) ?? [];
        for (const tp of tradePlayers) {
          const scores = (allRounds ?? [])
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

    const result = (trades ?? []).map((t) => ({
      trade: t,
      players: (playersByTrade.get(t.id) ?? []).map((p) => ({
        ...p,
        draft_position: draftPosByPlayer.get(p.player_id) ?? null,
        injured: injuryByTradePlayer.get(`${t.id}-${p.player_id}`) ?? false,
      })),
      latestProbability: latestProbByTrade.get(t.id) ?? null,
      probabilityHistory: (historyByTrade.get(t.id) ?? []).slice().reverse(),
    }));

    return NextResponse.json({ trades: result });
  } catch (err) {
    console.error('[trades/list]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'List failed' },
      { status: 500 }
    );
  }
}
