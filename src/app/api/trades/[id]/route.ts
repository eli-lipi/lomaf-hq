import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';
import type { NormalizedPosition, PlayerPerformance, Trade, TradePlayer } from '@/lib/trades/types';
import { detectInjury } from '@/lib/trades/compute-probability';
import { normalizePosition, cleanPositionDisplay } from '@/lib/trades/positions';
import { recalculateTradeAcrossPostTradeRounds } from '@/lib/trades/recalculate';
import { autoExpectedAvg, autoExpectedGames } from '@/lib/trades/expected';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;

    const [tradeRes, playersRes, probsRes, latestPlayedRes] = await Promise.all([
      supabase.from('trades').select('*').eq('id', id).single(),
      supabase.from('trade_players').select('*').eq('trade_id', id),
      supabase
        .from('trade_probabilities')
        .select('*')
        .eq('trade_id', id)
        .order('round_number', { ascending: true }),
      // Cap probability rows at the latest round with actual played scores —
      // ignores stale future-round rows from the earlier recalc bug.
      supabase
        .from('player_rounds')
        .select('round_number')
        .not('points', 'is', null)
        .order('round_number', { ascending: false })
        .limit(1),
    ]);

    if (tradeRes.error || !tradeRes.data) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const trade = tradeRes.data as Trade;
    const players = (playersRes.data ?? []) as TradePlayer[];
    const allProbs = probsRes.data ?? [];
    const maxPlayedRound =
      (latestPlayedRes.data as { round_number: number }[] | null)?.[0]?.round_number ?? null;
    const probs =
      maxPlayedRound != null
        ? allProbs.filter((p) => p.round_number <= maxPlayedRound)
        : allProbs;
    const latestRound = probs.length > 0 ? probs[probs.length - 1].round_number : trade.round_executed;

    // Build per-player performance — covers the full trajectory (pre-trade
    // rounds + post-trade rounds) so the UI can show the before/after split.
    const playerIds = players.map((p) => p.player_id);
    const { data: playerRoundsAll } = await supabase
      .from('player_rounds')
      .select('player_id, team_id, round_number, points')
      .in('player_id', playerIds)
      .lte('round_number', latestRound);

    // Post-trade scores (on receiving team only) — used for post averages,
    // injury detection, the chart, etc.
    const scoresByKey = new Map<string, { round: number; points: number | null }[]>();
    // Pre-trade scores (any team) — used for the "before trade" half of the
    // scores-since-trade table. Keyed by player_id only.
    const preScoresByPlayer = new Map<number, { round: number; points: number | null }[]>();
    for (const r of playerRoundsAll ?? []) {
      if (r.round_number > trade.round_executed) {
        const key = `${r.player_id}-${r.team_id}`;
        if (!scoresByKey.has(key)) scoresByKey.set(key, []);
        scoresByKey.get(key)!.push({ round: r.round_number, points: r.points });
      } else {
        if (!preScoresByPlayer.has(r.player_id)) preScoresByPlayer.set(r.player_id, []);
        preScoresByPlayer.get(r.player_id)!.push({ round: r.round_number, points: r.points });
      }
    }

    const roundsPossible = Math.max(0, latestRound - trade.round_executed);

    // Draft position lookup — the stable per-player position (not BN)
    const { data: draftRows } = await supabase
      .from('draft_picks')
      .select('player_id, position')
      .in('player_id', playerIds);
    const draftPosByPlayer = new Map<number, string>();
    for (const d of (draftRows ?? []) as { player_id: number; position: string | null }[]) {
      if (d.position) draftPosByPlayer.set(d.player_id, d.position);
    }

    const playerPerformance: PlayerPerformance[] = players.map((p) => {
      const key = `${p.player_id}-${p.receiving_team_id}`;
      const rounds = (scoresByKey.get(key) ?? []).sort((a, b) => a.round - b.round);
      const preRounds = (preScoresByPlayer.get(p.player_id) ?? []).sort((a, b) => a.round - b.round);
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
        draft_position: draftPosByPlayer.get(p.player_id) ?? null,
        pre_trade_avg: p.pre_trade_avg,
        post_trade_avg: postAvg,
        rounds_played: roundsPlayed,
        rounds_possible: roundsPossible,
        injured: injury.injured,
        missed_rounds: injury.missedRounds,
        round_scores: rounds,
        pre_trade_round_scores: preRounds,
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

// ============================================================
// PATCH — edit an existing trade (teams, round, context, players)
// ============================================================

interface PatchPlayer {
  player_id: number;
  player_name: string;
  raw_position: string | null;
  receiving_team_id: number;
  expected_avg?: number | null;
  expected_games?: number | null;
  // v11 — admin Edit flow can backfill these on existing trades.
  expected_tier?: 'superstar' | 'elite' | 'good' | 'average' | 'unrated' | null;
  expected_games_remaining?: number | null;
  expected_games_max?: number | null;
  player_context?: string | null;
}

interface PatchBody {
  team_a_id?: number;
  team_b_id?: number;
  round_executed?: number;
  context_notes?: string | null;
  players?: PatchPlayer[];
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json()) as PatchBody;

    // 1. Fetch existing trade
    const { data: existing, error: fetchErr } = await supabase
      .from('trades')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // 2. Resolve team updates (validate IDs exist in TEAMS)
    const nextTeamAId = body.team_a_id ?? existing.team_a_id;
    const nextTeamBId = body.team_b_id ?? existing.team_b_id;
    const teamA = TEAMS.find((t) => t.team_id === nextTeamAId);
    const teamB = TEAMS.find((t) => t.team_id === nextTeamBId);
    if (!teamA || !teamB || teamA.team_id === teamB.team_id) {
      return NextResponse.json({ error: 'Invalid team selection' }, { status: 400 });
    }

    const nextRound = body.round_executed ?? existing.round_executed;

    // Recompute polarity + ladder snapshot if teams or round changed.
    let positive_team_id: number = existing.positive_team_id ?? teamA.team_id;
    let negative_team_id: number = existing.negative_team_id ?? teamB.team_id;
    let team_a_ladder_at_trade: number | null = existing.team_a_ladder_at_trade ?? null;
    let team_b_ladder_at_trade: number | null = existing.team_b_ladder_at_trade ?? null;

    const teamsChanged =
      existing.team_a_id !== teamA.team_id || existing.team_b_id !== teamB.team_id;
    const roundChanged = existing.round_executed !== nextRound;
    if (teamsChanged || roundChanged || existing.positive_team_id == null) {
      const { data: snapAtExec } = await supabase
        .from('team_snapshots')
        .select('team_id, league_rank')
        .in('team_id', [teamA.team_id, teamB.team_id])
        .eq('round_number', nextRound);
      team_a_ladder_at_trade =
        (snapAtExec ?? []).find((s) => s.team_id === teamA.team_id)?.league_rank ?? null;
      team_b_ladder_at_trade =
        (snapAtExec ?? []).find((s) => s.team_id === teamB.team_id)?.league_rank ?? null;

      if (team_a_ladder_at_trade != null && team_b_ladder_at_trade != null && team_a_ladder_at_trade !== team_b_ladder_at_trade) {
        if (team_a_ladder_at_trade < team_b_ladder_at_trade) {
          positive_team_id = teamA.team_id;
          negative_team_id = teamB.team_id;
        } else {
          positive_team_id = teamB.team_id;
          negative_team_id = teamA.team_id;
        }
      } else {
        // Tiebreaker: alphabetical by team name
        if (teamA.team_name.localeCompare(teamB.team_name) <= 0) {
          positive_team_id = teamA.team_id;
          negative_team_id = teamB.team_id;
        } else {
          positive_team_id = teamB.team_id;
          negative_team_id = teamA.team_id;
        }
      }
    }

    // 3. Update trade row
    const { error: updateErr } = await supabase
      .from('trades')
      .update({
        team_a_id: teamA.team_id,
        team_a_name: teamA.team_name,
        team_b_id: teamB.team_id,
        team_b_name: teamB.team_name,
        round_executed: nextRound,
        context_notes: body.context_notes !== undefined ? body.context_notes : existing.context_notes,
        positive_team_id,
        negative_team_id,
        team_a_ladder_at_trade,
        team_b_ladder_at_trade,
      })
      .eq('id', id);
    if (updateErr) throw updateErr;

    // 4. If players changed, fully replace them (easier than diffing)
    if (body.players && body.players.length > 0) {
      await supabase.from('trade_players').delete().eq('trade_id', id);

      // Recompute pre_trade_avg + raw position based on new round_executed
      const playerIds = body.players.map((p) => p.player_id);
      const { data: preRounds } = await supabase
        .from('player_rounds')
        .select('player_id, points, round_number, pos')
        .in('player_id', playerIds)
        .lt('round_number', nextRound);

      const scoresByPlayer = new Map<number, number[]>();
      const posByPlayer = new Map<number, string>();
      const rawScoresByPlayer = new Map<number, { round: number; points: number | null }[]>();
      for (const r of preRounds ?? []) {
        if (!rawScoresByPlayer.has(r.player_id)) rawScoresByPlayer.set(r.player_id, []);
        rawScoresByPlayer.get(r.player_id)!.push({ round: r.round_number, points: r.points });
        if (r.points !== null && r.points !== undefined) {
          if (!scoresByPlayer.has(r.player_id)) scoresByPlayer.set(r.player_id, []);
          scoresByPlayer.get(r.player_id)!.push(Number(r.points));
        }
        const cleaned = cleanPositionDisplay(r.pos);
        if (cleaned && !posByPlayer.has(r.player_id)) posByPlayer.set(r.player_id, cleaned);
      }

      // Draft positions for tier-baseline lookup
      const { data: draftPicks } = await supabase
        .from('draft_picks')
        .select('player_id, position')
        .in('player_id', playerIds);
      const draftPosByPlayer = new Map<number, string>();
      for (const d of (draftPicks ?? []) as { player_id: number; position: string | null }[]) {
        if (d.position) draftPosByPlayer.set(d.player_id, d.position);
      }

      const playerRows = body.players.map((p) => {
        const receivingTeam = p.receiving_team_id === teamA.team_id ? teamA : teamB;
        const scores = scoresByPlayer.get(p.player_id) ?? [];
        const preAvg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        const rawPos = p.raw_position || posByPlayer.get(p.player_id) || null;
        const draftPos = draftPosByPlayer.get(p.player_id) ?? null;
        const priorRounds = rawScoresByPlayer.get(p.player_id) ?? [];

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
        const expected_games =
          p.expected_games != null && p.expected_games >= 0 && p.expected_games <= 4
            ? p.expected_games
            : autoExpectedGames({ prior_round_scores: priorRounds });

        return {
          trade_id: id,
          player_id: p.player_id,
          player_name: p.player_name,
          player_position: normalizePosition(rawPos),
          raw_position: rawPos,
          receiving_team_id: receivingTeam.team_id,
          receiving_team_name: receivingTeam.team_name,
          pre_trade_avg: preAvg,
          expected_avg,
          expected_avg_source,
          expected_games,
          // v11 — admin edit can backfill tier system fields on existing trades.
          expected_tier: p.expected_tier ?? null,
          expected_games_remaining: p.expected_games_remaining ?? null,
          expected_games_max: p.expected_games_max ?? null,
          player_context: p.player_context ?? null,
        };
      });

      const { error: insertErr } = await supabase.from('trade_players').insert(playerRows);
      if (insertErr) throw insertErr;
    }

    // 5. Wipe old probability rows — they're based on stale assumptions — and recompute fresh
    await supabase.from('trade_probabilities').delete().eq('trade_id', id);

    try {
      await recalculateTradeAcrossPostTradeRounds(supabase, id, { force: true });
    } catch (e) {
      console.error('[trades/[id] PATCH] Recalc failed', e);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[trades/[id] PATCH]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Edit failed' },
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
