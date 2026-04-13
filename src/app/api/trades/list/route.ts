import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const tradeIds = (trades ?? []).map((t) => t.id);
    if (tradeIds.length === 0) return NextResponse.json({ trades: [] });

    const [playersRes, probsRes] = await Promise.all([
      supabase.from('trade_players').select('*').in('trade_id', tradeIds),
      supabase
        .from('trade_probabilities')
        .select('*')
        .in('trade_id', tradeIds)
        .order('round_number', { ascending: false }),
    ]);

    const playersByTrade = new Map<string, unknown[]>();
    for (const p of playersRes.data ?? []) {
      if (!playersByTrade.has(p.trade_id)) playersByTrade.set(p.trade_id, []);
      playersByTrade.get(p.trade_id)!.push(p);
    }

    const latestProbByTrade = new Map<string, unknown>();
    const historyByTrade = new Map<string, unknown[]>();
    for (const row of probsRes.data ?? []) {
      if (!historyByTrade.has(row.trade_id)) historyByTrade.set(row.trade_id, []);
      historyByTrade.get(row.trade_id)!.push(row);
      // Since sorted desc, first one we see per trade is the latest
      if (!latestProbByTrade.has(row.trade_id)) latestProbByTrade.set(row.trade_id, row);
    }

    const result = (trades ?? []).map((t) => ({
      trade: t,
      players: playersByTrade.get(t.id) ?? [],
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
