import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';
import { normalizePosition, cleanPositionDisplay } from '@/lib/trades/positions';
import { recalculateTradeAcrossPostTradeRounds } from '@/lib/trades/recalculate';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface CreatePlayerInput {
  player_id: number;
  player_name: string;
  raw_position: string | null;
  receiving_team_id: number;
}

interface CreateBody {
  team_a_id: number;
  team_b_id: number;
  round_executed: number;
  context_notes: string | null;
  screenshot_url: string | null;
  players: CreatePlayerInput[];
  current_round?: number;  // optional; used to trigger initial recalc
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBody;

    if (!body.team_a_id || !body.team_b_id || body.round_executed === undefined || !body.players?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const teamA = TEAMS.find((t) => t.team_id === body.team_a_id);
    const teamB = TEAMS.find((t) => t.team_id === body.team_b_id);
    if (!teamA || !teamB) {
      return NextResponse.json({ error: 'Unknown team_id(s)' }, { status: 400 });
    }

    // 1. Insert trade
    const { data: tradeRow, error: tradeErr } = await supabase
      .from('trades')
      .insert({
        team_a_id: teamA.team_id,
        team_a_name: teamA.team_name,
        team_b_id: teamB.team_id,
        team_b_name: teamB.team_name,
        round_executed: body.round_executed,
        context_notes: body.context_notes || null,
        screenshot_url: body.screenshot_url || null,
      })
      .select()
      .single();

    if (tradeErr || !tradeRow) throw tradeErr ?? new Error('Insert failed');

    // 2. Compute pre-trade averages per player (points before round_executed)
    const playerIds = body.players.map((p) => p.player_id);
    const { data: preRounds } = await supabase
      .from('player_rounds')
      .select('player_id, points, round_number, pos')
      .in('player_id', playerIds)
      .lt('round_number', body.round_executed);

    const preAvgByPlayer = new Map<number, number>();
    const posByPlayer = new Map<number, string>();
    const scoresByPlayer = new Map<number, number[]>();
    for (const r of preRounds ?? []) {
      if (r.points !== null && r.points !== undefined) {
        if (!scoresByPlayer.has(r.player_id)) scoresByPlayer.set(r.player_id, []);
        scoresByPlayer.get(r.player_id)!.push(Number(r.points));
      }
      // Only store real positions (DEF/MID/FWD/RUC), never lineup slots (BN/UTL)
      const cleaned = cleanPositionDisplay(r.pos);
      if (cleaned && !posByPlayer.has(r.player_id)) {
        posByPlayer.set(r.player_id, cleaned);
      }
    }
    for (const [id, scores] of scoresByPlayer.entries()) {
      if (scores.length > 0) {
        preAvgByPlayer.set(id, scores.reduce((a, b) => a + b, 0) / scores.length);
      }
    }

    // 3. Insert trade_players
    const playerRows = body.players.map((p) => {
      const receivingTeam = p.receiving_team_id === teamA.team_id ? teamA : teamB;
      const rawPos = p.raw_position || posByPlayer.get(p.player_id) || null;
      return {
        trade_id: tradeRow.id,
        player_id: p.player_id,
        player_name: p.player_name,
        player_position: normalizePosition(rawPos),
        raw_position: rawPos,
        receiving_team_id: receivingTeam.team_id,
        receiving_team_name: receivingTeam.team_name,
        pre_trade_avg: preAvgByPlayer.get(p.player_id) ?? null,
      };
    });

    const { error: playersErr } = await supabase.from('trade_players').insert(playerRows);
    if (playersErr) throw playersErr;

    // 4. Kick off initial recalc across every post-trade round that has data.
    //    This builds the full probability-over-time curve even if the trade is
    //    logged retroactively after several rounds of scores are already in.
    try {
      await recalculateTradeAcrossPostTradeRounds(supabase, tradeRow.id);
    } catch (e) {
      console.error('[trades/create] Initial recalc failed', e);
    }

    return NextResponse.json({ trade: tradeRow, players: playerRows });
  } catch (err) {
    console.error('[trades/create]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 500 }
    );
  }
}
