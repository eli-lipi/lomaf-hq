import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';
import { normalizePosition, cleanPositionDisplay } from '@/lib/trades/positions';
import { recalculateTradeAcrossPostTradeRounds } from '@/lib/trades/recalculate';
import { autoExpectedAvg, autoExpectedGames } from '@/lib/trades/expected';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface CreatePlayerInput {
  player_id: number;
  player_name: string;
  raw_position: string | null;
  receiving_team_id: number;
  expected_avg?: number | null;       // optional manual override
  expected_games?: number | null;     // optional manual override (0..4)
}

interface CreateBody {
  team_a_id: number;
  team_b_id: number;
  round_executed: number;
  context_notes: string | null;
  screenshot_url: string | null;
  players: CreatePlayerInput[];
}

/**
 * Decide the polarity ("positive" axis) for the chart at trade time.
 *
 * Positive axis = whichever team had the better ladder position at
 * round_executed. Falls back to fewer-players-received, then alphabetical
 * by team name. Locked at trade creation — never recomputes.
 */
function decidePolarity(
  teamAId: number,
  teamAName: string,
  teamBId: number,
  teamBName: string,
  ladderA: number | null,
  ladderB: number | null,
  countA: number,
  countB: number
): { positive: number; negative: number } {
  if (ladderA != null && ladderB != null && ladderA !== ladderB) {
    return ladderA < ladderB
      ? { positive: teamAId, negative: teamBId }
      : { positive: teamBId, negative: teamAId };
  }
  if (countA !== countB) {
    return countA < countB
      ? { positive: teamAId, negative: teamBId }
      : { positive: teamBId, negative: teamAId };
  }
  return teamAName.localeCompare(teamBName) <= 0
    ? { positive: teamAId, negative: teamBId }
    : { positive: teamBId, negative: teamAId };
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

    // ── Look up ladder positions at execution round (for polarity & header) ──
    const { data: snapAtExec } = await supabase
      .from('team_snapshots')
      .select('team_id, league_rank')
      .in('team_id', [teamA.team_id, teamB.team_id])
      .eq('round_number', body.round_executed);
    const ladderA =
      (snapAtExec ?? []).find((s) => s.team_id === teamA.team_id)?.league_rank ?? null;
    const ladderB =
      (snapAtExec ?? []).find((s) => s.team_id === teamB.team_id)?.league_rank ?? null;

    // Player counts per side (used as polarity tiebreaker)
    const countAReceived = body.players.filter((p) => p.receiving_team_id === teamA.team_id).length;
    const countBReceived = body.players.filter((p) => p.receiving_team_id === teamB.team_id).length;

    const { positive, negative } = decidePolarity(
      teamA.team_id,
      teamA.team_name,
      teamB.team_id,
      teamB.team_name,
      ladderA,
      ladderB,
      countAReceived,
      countBReceived
    );

    // 1. Insert trade with polarity + ladder snapshot baked in
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
        positive_team_id: positive,
        negative_team_id: negative,
        team_a_ladder_at_trade: ladderA,
        team_b_ladder_at_trade: ladderB,
      })
      .select()
      .single();

    if (tradeErr || !tradeRow) throw tradeErr ?? new Error('Insert failed');

    // 2. Pull pre-trade rounds for every player (points + position fallback)
    const playerIds = body.players.map((p) => p.player_id);
    const { data: preRounds } = await supabase
      .from('player_rounds')
      .select('player_id, points, round_number, pos')
      .in('player_id', playerIds)
      .lt('round_number', body.round_executed);

    const preAvgByPlayer = new Map<number, number>();
    const posByPlayer = new Map<number, string>();
    const scoresByPlayer = new Map<number, number[]>();
    const rawScoresByPlayer = new Map<number, { round: number; points: number | null }[]>();
    for (const r of preRounds ?? []) {
      if (!rawScoresByPlayer.has(r.player_id)) rawScoresByPlayer.set(r.player_id, []);
      rawScoresByPlayer.get(r.player_id)!.push({ round: r.round_number, points: r.points });
      if (r.points !== null && r.points !== undefined) {
        if (!scoresByPlayer.has(r.player_id)) scoresByPlayer.set(r.player_id, []);
        scoresByPlayer.get(r.player_id)!.push(Number(r.points));
      }
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

    // Pull draft positions (stable, never BN) — preferred over round-position fallback
    const { data: draftPicks } = await supabase
      .from('draft_picks')
      .select('player_id, position')
      .in('player_id', playerIds);
    const draftPosByPlayer = new Map<number, string>();
    for (const d of (draftPicks ?? []) as { player_id: number; position: string | null }[]) {
      if (d.position) draftPosByPlayer.set(d.player_id, d.position);
    }

    // 3. Build trade_players rows with auto-derived expected_avg + expected_games
    const playerRows = body.players.map((p) => {
      const receivingTeam = p.receiving_team_id === teamA.team_id ? teamA : teamB;
      const rawPos = p.raw_position || posByPlayer.get(p.player_id) || null;
      const draftPos = draftPosByPlayer.get(p.player_id) ?? null;
      const priorRounds = rawScoresByPlayer.get(p.player_id) ?? [];

      // Expected avg: manual override beats auto
      let expected_avg: number;
      let expected_avg_source: 'manual' | 'auto';
      if (p.expected_avg != null && p.expected_avg > 0) {
        expected_avg = p.expected_avg;
        expected_avg_source = 'manual';
      } else {
        const auto = autoExpectedAvg({
          raw_position: rawPos,
          draft_position: draftPos,
          prior_round_scores: priorRounds,
        });
        expected_avg = auto.expected_avg;
        expected_avg_source = 'auto';
      }

      // Expected games: manual override (0..4) beats auto
      const expected_games =
        p.expected_games != null && p.expected_games >= 0 && p.expected_games <= 4
          ? p.expected_games
          : autoExpectedGames({ prior_round_scores: priorRounds });

      return {
        trade_id: tradeRow.id,
        player_id: p.player_id,
        player_name: p.player_name,
        player_position: normalizePosition(rawPos),
        raw_position: rawPos,
        receiving_team_id: receivingTeam.team_id,
        receiving_team_name: receivingTeam.team_name,
        pre_trade_avg: preAvgByPlayer.get(p.player_id) ?? null,
        expected_avg,
        expected_avg_source,
        expected_games,
      };
    });

    const { error: playersErr } = await supabase.from('trade_players').insert(playerRows);
    if (playersErr) throw playersErr;

    // 4. Kick off initial recalc across every post-trade round that has data.
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
