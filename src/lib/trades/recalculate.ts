import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PlayerPerformance,
  Trade,
  TradePlayer,
  NormalizedPosition,
  TradeFactorsBreakdown,
} from './types';
import { computeProbability, detectInjury, type PlayerSidePerf } from './compute-probability';
import { generateTradeNarrative, type LineRanks } from './ai-assessment';
import { cleanPositionDisplay } from './positions';

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

  // 3. Build PlayerPerformance for both sides.
  //    v2 — post_trade_avg is now computed over PLAYED rounds only (DNPs are
  //    dropped). The availability story is told separately by the
  //    rounds_played / expected_games ratio.
  const performance: PlayerPerformance[] = players.map((p) => {
    const key = `${p.player_id}-${p.receiving_team_id}`;
    const rounds = (scoresByPlayer.get(key) ?? []).sort((a, b) => a.round - b.round);
    const playedRounds = rounds.filter((r) => r.points !== null && r.points !== undefined && r.points > 0);
    const roundsPlayed = playedRounds.length;
    const pointsSum = playedRounds.reduce((sum, r) => sum + (r.points ?? 0), 0);
    // Avg over played rounds only. DNPs/0s are dropped from the divisor.
    const postTradeAvg = roundsPlayed > 0 ? pointsSum / roundsPlayed : 0;

    const recentScores = rounds.map((r) => r.points);
    const injury = detectInjury(recentScores, p.pre_trade_avg);

    return {
      player_id: p.player_id,
      player_name: p.player_name,
      receiving_team_id: p.receiving_team_id,
      receiving_team_name: p.receiving_team_name,
      position: (p.player_position as NormalizedPosition | null) ?? null,
      raw_position: p.raw_position,
      draft_position: null,
      pre_trade_avg: p.pre_trade_avg,
      post_trade_avg: postTradeAvg,
      rounds_played: roundsPlayed,
      rounds_possible: roundsSince,
      injured: injury.injured,
      missed_rounds: injury.missedRounds,
      round_scores: rounds,
      pre_trade_round_scores: [],
    };
  });

  const teamA = performance.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamB = performance.filter((p) => p.receiving_team_id === trade.team_b_id);

  // v2 — Build PlayerSidePerf rows for the new probability calc. Uses each
  // trade_player's locked expected_avg/games, falling back to pre_trade_avg
  // and 4 if they were not populated (legacy rows pre-migration).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerByIdAndSide = new Map<string, any>();
  for (const p of players as unknown as Array<Record<string, unknown>>) {
    const k = `${p.player_id}-${p.receiving_team_id}`;
    playerByIdAndSide.set(k, p);
  }
  const buildSidePerf = (perf: PlayerPerformance[]): PlayerSidePerf[] =>
    perf.map((p) => {
      const tp = playerByIdAndSide.get(`${p.player_id}-${p.receiving_team_id}`) as
        | { expected_avg?: number | null; expected_games?: number | null }
        | undefined;
      const expected_avg =
        (tp?.expected_avg as number | null | undefined) ??
        p.pre_trade_avg ??
        70; // last-ditch baseline
      const expected_games =
        tp?.expected_games != null ? Number(tp.expected_games) : 4;
      return {
        player_id: p.player_id,
        expected_avg,
        expected_games,
        rounds_played: p.rounds_played,
        avg_when_played: p.rounds_played > 0 ? p.post_trade_avg : null,
      };
    });

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

  // v12 — invalidate cached narrative if its polarity disagrees with the
  // current probability. Probability is computed from raw production etc.
  // and is the authoritative read; the narrative must align with it. If the
  // cached narrative was written when the trade was leaning the other way,
  // it would now read as a contradiction next to the chart.
  let cacheValid = !!(existingProb?.ai_assessment && cachedFactors);
  if (cacheValid && cachedFactors && existingProb) {
    const cachedProbA = Number(existingProb.team_a_probability ?? 50);
    const cachedLeader: 'team_a' | 'team_b' | 'even' =
      cachedProbA > 55 ? 'team_a' : cachedProbA < 45 ? 'team_b' : 'even';
    const cachedEdge = cachedFactors.aiEdge ?? 'even';
    if (
      cachedLeader !== 'even' &&
      cachedEdge !== 'even' &&
      cachedLeader !== cachedEdge
    ) {
      cacheValid = false;
    }
  }

  // v12.1 — invalidate any narrative that mentions 'predicted' or
  // 'prediction' next to a number. The old prompt told the AI to call
  // pre-trade season-to-date avg the prediction, which is wrong.
  // Regenerating against the new prompt produces a cleaner read framed
  // around expected_avg.
  if (cacheValid && existingProb?.ai_assessment) {
    const txt = (existingProb.ai_assessment as string).toLowerCase();
    if (/predicted|prediction/.test(txt)) {
      cacheValid = false;
    }
  }

  if (!force && cacheValid && existingProb?.ai_assessment && cachedFactors) {
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

    // v11 — fold expected_tier and per-player context into the AI breakdown
    // so the analysis can reference them when explaining underperformance.
    // v12 — also fold draft_position so the analysis knows the player's
    // league identity (drafted as DEF, drafted as MID, etc.).
    // v12.3 — also fold the official AFL injury list (afl_injuries) so
    // the AI cites real prognoses instead of inferring from DNP patterns.
    // v12.4 — pull canonical season-wide stats from `players` so the
    // AI can lean on AFL Fantasy projections + form when writing the
    // narrative (e.g. 'Bontempelli is averaging 75 over last 3 vs his
    // 110 projection — cooling').
    const playerIdsAll = (players as unknown as Array<{ player_id: number }>).map((p) => p.player_id);
    interface PlayerStats {
      proj_avg: number | null;
      avg_pts: number | null;
      last3_avg: number | null;
      last5_avg: number | null;
    }
    const statsByPlayer = new Map<number, PlayerStats>();
    if (playerIdsAll.length > 0) {
      const { data: pl } = await supabase
        .from('players')
        .select('player_id, proj_avg, avg_pts, last3_avg, last5_avg')
        .in('player_id', playerIdsAll);
      for (const r of (pl ?? []) as Array<{ player_id: number | null } & PlayerStats>) {
        if (r.player_id != null) {
          statsByPlayer.set(r.player_id, {
            proj_avg: r.proj_avg,
            avg_pts: r.avg_pts,
            last3_avg: r.last3_avg,
            last5_avg: r.last5_avg,
          });
        }
      }
    }

    const tradePlayerById = new Map<
      number,
      {
        tier?: string | null;
        ctx?: string | null;
        draftPos?: string | null;
        draftPick?: number | null;
        expectedAvg?: number | null;
        injuryLine?: string | null;
        statsLine?: string | null;
      }
    >();

    // Pull official injuries + snapshot history for any of the trade's
    // players in one go.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerIdsForInjuries = (players as unknown as any[]).map((p) => p.player_id);
    const injuryById = new Map<
      number,
      { injury: string | null; estimated_return: string | null; source_updated_at: string | null }
    >();
    if (playerIdsForInjuries.length > 0) {
      const { data: injRows } = await supabase
        .from('afl_injuries')
        .select('player_id, injury, estimated_return, source_updated_at')
        .in('player_id', playerIdsForInjuries);
      for (const r of (injRows ?? []) as Array<{
        player_id: number | null;
        injury: string | null;
        estimated_return: string | null;
        source_updated_at: string | null;
      }>) {
        if (r.player_id != null) {
          injuryById.set(r.player_id, {
            injury: r.injury,
            estimated_return: r.estimated_return,
            source_updated_at: r.source_updated_at,
          });
        }
      }
    }
    const { formatInjuryForPrompt, formatTrendForPrompt, computeInjuryTrend, fetchSnapshotsForPlayers } =
      await import('../afl-injuries');
    const snapshotsByPlayer = await fetchSnapshotsForPlayers(supabase, playerIdsForInjuries);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const tp of (players as unknown as any[])) {
      const inj = injuryById.get(tp.player_id);
      let injuryLine: string | null = null;
      if (inj) {
        injuryLine = formatInjuryForPrompt(inj);
        const trend = computeInjuryTrend(snapshotsByPlayer.get(tp.player_id) ?? []);
        const trendLine = formatTrendForPrompt(trend);
        if (trendLine) injuryLine += `\n    ${trendLine}`;
      }
      const stats = statsByPlayer.get(tp.player_id);
      let statsLine: string | null = null;
      if (stats) {
        const parts: string[] = [];
        if (stats.proj_avg != null) parts.push(`AFL projAvg ${Math.round(stats.proj_avg)}`);
        if (stats.avg_pts != null) parts.push(`season avg ${Math.round(stats.avg_pts)}`);
        if (stats.last3_avg != null) parts.push(`last-3 ${Math.round(stats.last3_avg)}`);
        if (parts.length > 0) statsLine = parts.join(', ');
      }
      tradePlayerById.set(tp.player_id, {
        tier: tp.expected_tier ?? null,
        ctx: tp.player_context ?? null,
        draftPos: tp.draft_position ?? null,
        draftPick: tp.draft_pick ?? null,
        expectedAvg: tp.expected_avg ?? null,
        injuryLine,
        statsLine,
      });
    }

    const playerBreakdownLines = performance.map((p) => {
      const status = p.injured ? '🔴 Injured' : '✅ Active';
      const tradeMeta = tradePlayerById.get(p.player_id);
      // v12.1 — the AI must reason against the EXPECTED AVERAGE (the
      // explicit bet locked at trade time), NOT the pre-trade season
      // average. Pre-trade avg is a noisy, often-tiny sample and is a
      // poor predictor for the rest of the season — especially for
      // trades made in the first few rounds.
      const expected = tradeMeta?.expectedAvg ?? null;
      const expectedStr = expected != null ? expected.toFixed(0) : '?';
      const pre = p.pre_trade_avg ?? null;
      const preStr = pre != null ? pre.toFixed(0) : '?';
      const post = p.rounds_played > 0 ? p.post_trade_avg.toFixed(0) : '—';
      const gap =
        expected != null && p.rounds_played > 0
          ? p.post_trade_avg - expected
          : null;
      const gapStr =
        gap == null
          ? ''
          : gap >= 0
            ? ` (+${gap.toFixed(0)} vs expected)`
            : ` (${gap.toFixed(0)} vs expected)`;
      const perRound = p.round_scores.length > 0
        ? p.round_scores
            .map((s) => `R${s.round}:${s.points == null ? 'DNP' : s.points}`)
            .join(', ')
        : '(no rounds played since trade)';
      const tierStr = tradeMeta?.tier ? ` · expected tier: ${tradeMeta.tier}` : '';
      const ctxStr = tradeMeta?.ctx ? `\n    trader's note: "${tradeMeta.ctx}"` : '';
      // v12.3 — surface the AFL.com.au official prognosis when present.
      // The prompt instructs the model to cite this verbatim and to NOT
      // re-infer injury status from DNPs when an official line exists.
      const injStr = tradeMeta?.injuryLine ? `\n    ${tradeMeta.injuryLine}` : '';
      // v12.4 — canonical AFL Fantasy projection + form context.
      const statsStr = tradeMeta?.statsLine ? `\n    AFL FANTASY: ${tradeMeta.statsLine}` : '';
      const draftPos = tradeMeta?.draftPos;
      const draftPick = tradeMeta?.draftPick;
      const livePos = cleanPositionDisplay(p.raw_position) ?? p.position ?? '?';
      const posPart = draftPos && draftPos !== livePos
        ? `${livePos}, drafted ${draftPos}`
        : livePos;
      const pickPart = draftPick && draftPick > 0 ? ` · Pick #${draftPick}` : '';
      const posStr = `${posPart}${pickPart}`;
      return `- ${p.player_name} (${posStr}) → ${p.receiving_team_name}: expected avg ${expectedStr}${tierStr}, pre-trade season-to-date avg ${preStr} (small-sample, NOT a prediction), actual avg ${post}${gapStr}, ${p.rounds_played}/${p.rounds_possible} rounds, ${status}\n    scores: ${perRound}${ctxStr}${injStr}${statsStr}`;
    });

    const teamAReceives = teamA.map((p) => p.player_name);
    const teamBReceives = teamB.map((p) => p.player_name);

    // Pre-compute a first-pass probability using no AI nudge — so we can show
    // the model the current state before asking it for a final read.
    const preliminary = computeProbability({
      roundsSince,
      currentRound: roundNumber,
      teamA: buildSidePerf(teamA),
      teamB: buildSidePerf(teamB),
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
  const { advantageA, probA, probB, factors } = computeProbability({
    roundsSince,
    currentRound: roundNumber,
    teamA: buildSidePerf(teamA),
    teamB: buildSidePerf(teamB),
    teamAPerformance: teamA,
    teamBPerformance: teamB,
    aiEdge,
    aiMagnitude,
  });

  // Polarity-flip the advantage for storage. positive_team_id = team_b means
  // a positive advantage_a is a negative stored advantage (positive side is
  // losing).
  const advantage =
    trade.positive_team_id != null && trade.positive_team_id === trade.team_b_id
      ? -advantageA
      : advantageA;

  // 7. Upsert
  await supabase.from('trade_probabilities').upsert(
    {
      trade_id: tradeId,
      round_number: roundNumber,
      team_a_probability: Number(probA.toFixed(2)),
      team_b_probability: Number(probB.toFixed(2)),
      advantage,
      factors,
      ai_assessment: aiNarrative || null,
      calculated_at: new Date().toISOString(),
    },
    { onConflict: 'trade_id,round_number' }
  );
}

/**
 * Recalculate probabilities for every round since the trade took effect, up to
 * the latest round with player_rounds data. This is the right behavior when a
 * trade is newly logged (or edited) after several rounds of scores already exist,
 * so we build the full probability-over-time curve instead of a single point.
 */
export async function recalculateTradeAcrossPostTradeRounds(
  supabase: SupabaseClient,
  tradeId: string,
  opts: { force?: boolean; maxRound?: number } = {}
): Promise<{ rounds: number[] }> {
  const { data: trade } = await supabase
    .from('trades')
    .select('round_executed')
    .eq('id', tradeId)
    .single();
  if (!trade) return { rounds: [] };

  const { data: playerRows } = await supabase
    .from('trade_players')
    .select('player_id')
    .eq('trade_id', tradeId);
  const playerIds = (playerRows ?? []).map((p: { player_id: number }) => p.player_id);

  let maxRound: number | null = opts.maxRound ?? null;
  if (maxRound == null && playerIds.length > 0) {
    // Only consider rounds with ACTUAL scores. Without this, CSVs that
    // pre-create columns for the entire AFL season (R0-R28) cause the recalc
    // to walk forward through unplayed rounds and stamp the trade with
    // 'Updated R28' bogus values.
    const { data } = await supabase
      .from('player_rounds')
      .select('round_number')
      .in('player_id', playerIds)
      .gt('round_number', trade.round_executed)
      .not('points', 'is', null)
      .order('round_number', { ascending: false })
      .limit(1);
    maxRound = (data as { round_number: number }[] | null)?.[0]?.round_number ?? null;
  }

  // No post-trade data yet — seed a single baseline row at round_executed so
  // the UI has something to render (shows ~50/50 at confidence 0).
  if (maxRound == null || maxRound <= trade.round_executed) {
    await recalculateTradeForRound(supabase, tradeId, trade.round_executed, opts.force === true);
    // Sweep any stale future-round rows (left over from old buggy recalcs that
    // walked into unplayed rounds).
    await supabase
      .from('trade_probabilities')
      .delete()
      .eq('trade_id', tradeId)
      .gt('round_number', trade.round_executed);
    return { rounds: [trade.round_executed] };
  }

  const rounds: number[] = [];
  for (let r = trade.round_executed + 1; r <= maxRound; r++) rounds.push(r);
  for (const r of rounds) {
    await recalculateTradeForRound(supabase, tradeId, r, opts.force === true);
  }
  // Sweep stale rows beyond the actual played rounds (idempotent cleanup).
  await supabase
    .from('trade_probabilities')
    .delete()
    .eq('trade_id', tradeId)
    .gt('round_number', maxRound);
  return { rounds };
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
      // Walk the full post-trade span so the trade's full probability curve
      // stays current (and so we sweep any stale future-round rows). The
      // span helper determines its own maxRound based on actual played
      // points — passing roundNumber here would incorrectly force walks
      // into unplayed rounds when the CSV grid has columns for R0-R28.
      await recalculateTradeAcrossPostTradeRounds(supabase, t.id, { force: true });
    } catch (e) {
      failed++;
      console.error(`[recalculate] Trade ${t.id} (after R${roundNumber}) failed`, e);
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

// v12 — exported so the create/PATCH endpoints can build justification
// inputs without duplicating snapshot logic.
export { fetchSnapshot, snapshotToLines };

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
