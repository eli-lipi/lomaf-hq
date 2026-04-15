import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PlayerPerformance,
  Trade,
  TradePlayer,
  NormalizedPosition,
  TradeFactorsBreakdown,
} from './types';
import { computeProbability, detectInjury } from './compute-probability';
import { generateTradeNarrative, type LineRanks } from './ai-assessment';

/**
 * Recalculate a single trade's probability for a given round and upsert to trade_probabilities.
 * Also (re)generates the AI narrative if not already cached for this round.
 *
 * @param force - if true, regenerate AI narrative even if cached.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recalculateTradeForRound(
  supabase: SupabaseClient,
  tradeId: string,
  roundNumber: number,
  force: boolean = false
): Promise<void> {
  // 1. Fetch trade + players
  const { data: tradeRow, error: tradeErr } = await supabase
    .from('trades')
    .select('*')
    .eq('id', tradeId)
    .single();
  if (tradeErr || !tradeRow) throw tradeErr ?? new Error('Trade not found');
  const trade = tradeRow as Trade;

  const { data: playersData } = await supabase
    .from('trade_players')
    .select('*')
    .eq('trade_id', tradeId);
  const players = (playersData ?? []) as TradePlayer[];
  if (players.length === 0) return;

  const roundsSince = Math.max(0, roundNumber - trade.round_executed);

  // 2. Fetch post-trade player_rounds for every traded player
  const playerIds = players.map((p) => p.player_id);
  const { data: roundsData } = await supabase
    .from('player_rounds')
    .select('player_id, team_id, round_number, points')
    .in('player_id', playerIds)
    .gt('round_number', trade.round_executed)
    .lte('round_number', roundNumber);

  // Build per-player score history on their RECEIVING team only (filter out
  // rows from before the trade by team — a player appears on multiple teams'
  // rows across the season if traded).
  const scoresByPlayer = new Map<string, { round: number; points: number | null }[]>();
  for (const r of roundsData ?? []) {
    const key = `${r.player_id}-${r.team_id}`;
    if (!scoresByPlayer.has(key)) scoresByPlayer.set(key, []);
    scoresByPlayer.get(key)!.push({ round: r.round_number, points: r.points });
  }

  // 3. Build PlayerPerformance for both sides
  const performance: PlayerPerformance[] = players.map((p) => {
    const key = `${p.player_id}-${p.receiving_team_id}`;
    const rounds = (scoresByPlayer.get(key) ?? []).sort((a, b) => a.round - b.round);
    const roundsPlayed = rounds.filter((r) => r.points !== null && r.points !== undefined).length;
    const pointsSum = rounds.reduce((sum, r) => sum + (r.points ?? 0), 0);
    const postTradeAvg = roundsPlayed > 0 ? pointsSum / Math.max(rounds.length, 1) : 0;

    const recentScores = rounds.map((r) => r.points);
    const injury = detectInjury(recentScores, p.pre_trade_avg);

    return {
      player_id: p.player_id,
      player_name: p.player_name,
      receiving_team_id: p.receiving_team_id,
      receiving_team_name: p.receiving_team_name,
      position: (p.player_position as NormalizedPosition | null) ?? null,
      raw_position: p.raw_position,
      pre_trade_avg: p.pre_trade_avg,
      post_trade_avg: postTradeAvg,
      rounds_played: roundsPlayed,
      rounds_possible: roundsSince,
      injured: injury.injured,
      missed_rounds: injury.missedRounds,
      round_scores: rounds,
    };
  });

  const teamA = performance.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamB = performance.filter((p) => p.receiving_team_id === trade.team_b_id);

  // 4. Check if AI narrative is cached
  let aiEdge: 'team_a' | 'team_b' | 'even' = 'even';
  let aiMagnitude = 0;
  let aiNarrative = '';

  const { data: existingProb } = await supabase
    .from('trade_probabilities')
    .select('*')
    .eq('trade_id', tradeId)
    .eq('round_number', roundNumber)
    .maybeSingle();

  const cachedFactors = existingProb?.factors as TradeFactorsBreakdown | null;

  if (!force && existingProb?.ai_assessment && cachedFactors) {
    aiNarrative = existingProb.ai_assessment;
    aiEdge = cachedFactors.aiEdge ?? 'even';
    aiMagnitude = cachedFactors.aiMagnitude ?? 0;
  } else {
    // 5. Gather context for AI narrative
    const [snapA_pre, snapA_cur, snapB_pre, snapB_cur] = await Promise.all([
      fetchSnapshot(supabase, trade.team_a_id, trade.round_executed - 1),
      fetchSnapshot(supabase, trade.team_a_id, roundNumber),
      fetchSnapshot(supabase, trade.team_b_id, trade.round_executed - 1),
      fetchSnapshot(supabase, trade.team_b_id, roundNumber),
    ]);

    const playerBreakdownLines = performance.map((p) => {
      const status = p.injured ? '🔴 Injured' : '✅ Active';
      const pre = p.pre_trade_avg?.toFixed(0) ?? '?';
      const post = p.rounds_played > 0 ? p.post_trade_avg.toFixed(0) : '—';
      // Per-round scores: "R3:72, R4:0, R5:88" — 0/null shown explicitly so
      // the model can see DNPs / injuries / bye patterns.
      const perRound = p.round_scores.length > 0
        ? p.round_scores
            .map((s) => `R${s.round}:${s.points == null ? 'DNP' : s.points}`)
            .join(', ')
        : '(no rounds played since trade)';
      return `- ${p.player_name} (${p.raw_position ?? '?'}) → ${p.receiving_team_name}: pre-trade avg ${pre}, post-trade avg ${post}, ${p.rounds_played}/${p.rounds_possible} rounds, ${status}\n    scores: ${perRound}`;
    });

    const teamAReceives = teamA.map((p) => p.player_name);
    const teamBReceives = teamB.map((p) => p.player_name);

    // Pre-compute a first-pass probability using no AI nudge — so we can show
    // the model the current state before asking it for a final read.
    const preliminary = computeProbability({
      roundsSince,
      currentRound: roundNumber,
      teamAPerformance: teamA,
      teamBPerformance: teamB,
      aiEdge: 'even',
      aiMagnitude: 0,
    });

    try {
      const result = await generateTradeNarrative(
        {
          teamA: {
            name: trade.team_a_name,
            ladder: snapA_cur?.league_rank ?? null,
            record: snapA_cur
              ? `${snapA_cur.wins}-${snapA_cur.losses}${snapA_cur.ties ? '-' + snapA_cur.ties : ''}`
              : '?',
            preTradeLines: snapshotToLines(snapA_pre),
            currentLines: snapshotToLines(snapA_cur),
          },
          teamB: {
            name: trade.team_b_name,
            ladder: snapB_cur?.league_rank ?? null,
            record: snapB_cur
              ? `${snapB_cur.wins}-${snapB_cur.losses}${snapB_cur.ties ? '-' + snapB_cur.ties : ''}`
              : '?',
            preTradeLines: snapshotToLines(snapB_pre),
            currentLines: snapshotToLines(snapB_cur),
          },
          teamAReceives,
          teamBReceives,
          roundExecuted: trade.round_executed,
          currentRound: roundNumber,
          contextNotes: trade.context_notes,
          playerBreakdown: playerBreakdownLines.join('\n'),
          probA: preliminary.probA,
          probB: preliminary.probB,
        },
        supabase
      );
      aiEdge = result.edge;
      aiMagnitude = result.magnitude;
      aiNarrative = result.narrative;
    } catch (e) {
      console.error('[recalculate] AI narrative failed, falling back to even/no-narrative', e);
    }
  }

  // 6. Final compute with AI edge
  const { probA, probB, factors } = computeProbability({
    roundsSince,
    currentRound: roundNumber,
    teamAPerformance: teamA,
    teamBPerformance: teamB,
    aiEdge,
    aiMagnitude,
  });

  // 7. Upsert
  await supabase.from('trade_probabilities').upsert(
    {
      trade_id: tradeId,
      round_number: roundNumber,
      team_a_probability: Number(probA.toFixed(2)),
      team_b_probability: Number(probB.toFixed(2)),
      factors,
      ai_assessment: aiNarrative || null,
      calculated_at: new Date().toISOString(),
    },
    { onConflict: 'trade_id,round_number' }
  );
}

/**
 * Recalculate probabilities for all trades that are "active" for the given round
 * (i.e., trades executed at or before this round).
 */
export async function recalculateAllTradesForRound(
  supabase: SupabaseClient,
  roundNumber: number
): Promise<{ attempted: number; failed: number }> {
  const { data: trades } = await supabase
    .from('trades')
    .select('id, round_executed')
    .lte('round_executed', roundNumber);

  let failed = 0;
  for (const t of trades ?? []) {
    try {
      await recalculateTradeForRound(supabase, t.id, roundNumber);
    } catch (e) {
      failed++;
      console.error(`[recalculate] Trade ${t.id} R${roundNumber} failed`, e);
    }
  }
  return { attempted: (trades ?? []).length, failed };
}

// --- Helpers ---

interface Snapshot {
  round_number: number;
  team_id: number;
  wins: number;
  losses: number;
  ties: number;
  league_rank: number;
  def_rank: number;
  mid_rank: number;
  fwd_rank: number;
  ruc_rank: number;
}

async function fetchSnapshot(
  supabase: SupabaseClient,
  teamId: number,
  roundNumber: number
): Promise<Snapshot | null> {
  if (roundNumber < 0) return null;
  const { data } = await supabase
    .from('team_snapshots')
    .select('round_number, team_id, wins, losses, ties, league_rank, def_rank, mid_rank, fwd_rank, ruc_rank')
    .eq('team_id', teamId)
    .lte('round_number', roundNumber)
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Snapshot | null) ?? null;
}

function snapshotToLines(snap: Snapshot | null): LineRanks {
  return {
    def: snap?.def_rank ?? null,
    mid: snap?.mid_rank ?? null,
    fwd: snap?.fwd_rank ?? null,
    ruc: snap?.ruc_rank ?? null,
  };
}
