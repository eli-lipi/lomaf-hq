import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { NormalizedPosition, PlayerPerformance, Trade, TradePlayer } from '@/lib/trades/types';
import { detectInjury } from '@/lib/trades/compute-probability';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;

    const [tradeRes, playersRes, probsRes] = await Promise.all([
      supabase.from('trades').select('*').eq('id', id).single(),
      supabase.from('trade_players').select('*').eq('trade_id', id),
      supabase
        .from('trade_probabilities')
        .select('*')
        .eq('trade_id', id)
        .order('round_number', { ascending: true }),
    ]);

    if (tradeRes.error || !tradeRes.data) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const trade = tradeRes.data as Trade;
    const players = (playersRes.data ?? []) as TradePlayer[];
    const probs = probsRes.data ?? [];
    const latestRound = probs.length > 0 ? probs[probs.length - 1].round_number : trade.round_executed;

    // Build per-player performance for the latest round
    const playerIds = players.map((p) => p.player_id);
    const { data: playerRounds } = await supabase
      .from('player_rounds')
      .select('player_id, team_id, round_number, points')
      .in('player_id', playerIds)
      .gt('round_number', trade.round_executed)
      .lte('round_number', latestRound);

    const scoresByKey = new Map<string, { round: number; points: number | null }[]>();
    for (const r of playerRounds ?? []) {
      const key = `${r.player_id}-${r.team_id}`;
      if (!scoresByKey.has(key)) scoresByKey.set(key, []);
      scoresByKey.get(key)!.push({ round: r.round_number, points: r.points });
    }

    const roundsPossible = Math.max(0, latestRound - trade.round_executed);

    const playerPerformance: PlayerPerformance[] = players.map((p) => {
      const key = `${p.player_id}-${p.receiving_team_id}`;
      const rounds = (scoresByKey.get(key) ?? []).sort((a, b) => a.round - b.round);
      const roundsPlayed = rounds.filter((r) => r.points !== null).length;
      const sum = rounds.reduce((s, r) => s + (r.points ?? 0), 0);
      const postAvg = rounds.length > 0 ? sum / rounds.length : 0;
      const injury = detectInjury(rounds.map((r) => r.points), p.pre_trade_avg);
      return {
        player_id: p.player_id,
        player_name: p.player_name,
        receiving_team_id: p.receiving_team_id,
        receiving_team_name: p.receiving_team_name,
        position: (p.player_position as NormalizedPosition | null) ?? null,
        raw_position: p.raw_position,
        pre_trade_avg: p.pre_trade_avg,
        post_trade_avg: postAvg,
        rounds_played: roundsPlayed,
        rounds_possible: roundsPossible,
        injured: injury.injured,
        missed_rounds: injury.missedRounds,
        round_scores: rounds,
      };
    });

    return NextResponse.json({
      trade,
      players,
      latestProbability: probs.length > 0 ? probs[probs.length - 1] : null,
      probabilityHistory: probs,
      playerPerformance,
    });
  } catch (err) {
    console.error('[trades/[id] GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fetch failed' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { error } = await supabase.from('trades').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[trades/[id] DELETE]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 }
    );
  }
}
