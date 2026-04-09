import { TEAMS } from './constants';

/**
 * Computed slide data for one team.
 * All numbers are derived from raw player_rounds, matchup_rounds,
 * score_adjustments, and team_snapshots — not from pre-computed fields
 * that may be stale.
 */
export interface SlideTeamData {
  scoreThisWeek: number | null;
  scoreThisWeekRank: number | null;
  seasonTotal: number | null;
  seasonTotalRank: number | null;
  record: { wins: number; losses: number; ties: number };
  ladderPosition: number | null;
  luckScore: number | null;
  luckRank: number | null;
  lineRanks: {
    def: number | null;
    mid: number | null;
    fwd: number | null;
    ruc: number | null;
    utl: number | null;
  };
}

// Accept any Supabase client (server or browser)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

/**
 * Computes all slide data for every team from raw sources.
 *
 * This replaces reading pre-computed fields from team_snapshots,
 * which can be stale when the latest round hasn't been scored yet.
 *
 * @param supabase  A @supabase/supabase-js client (browser or server-side)
 * @param pwrnkgsRoundNumber  The round number the PWRNKGs are for
 */
export async function computeSlideData(
  supabase: SupabaseAny,
  pwrnkgsRoundNumber: number
): Promise<Map<number, SlideTeamData>> {
  // ── 1. Fetch all player_rounds (paginated) ──
  const allPlayerRounds: {
    round_number: number;
    team_id: number;
    pos: string;
    points: number | null;
    is_scoring: boolean;
  }[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('player_rounds')
      .select('round_number, team_id, pos, points, is_scoring')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allPlayerRounds.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  // ── 2. Find rounds that actually have scores ──
  const roundsWithScores = new Set<number>();
  for (const p of allPlayerRounds) {
    if (p.is_scoring && p.points !== null && p.points !== undefined) {
      roundsWithScores.add(p.round_number);
    }
  }
  const scoredRounds = [...roundsWithScores].sort((a, b) => a - b);
  const latestScoredRound =
    scoredRounds.length > 0 ? scoredRounds[scoredRounds.length - 1] : null;

  // ── 3. Compute lineup sums per round per team ──
  const lineupSums: Record<string, number> = {};
  for (const p of allPlayerRounds) {
    if (!p.is_scoring || p.points == null) continue;
    const key = `${p.round_number}-${p.team_id}`;
    lineupSums[key] = (lineupSums[key] || 0) + Number(p.points);
  }

  // ── 4. Fetch matchup scores ──
  const { data: matchups } = await supabase
    .from('matchup_rounds')
    .select('round_number, team_id, score_for');
  const matchupScores: Record<string, number> = {};
  matchups?.forEach((m: { round_number: number; team_id: number; score_for: number }) => {
    matchupScores[`${m.round_number}-${m.team_id}`] = Number(m.score_for);
  });

  // ── 5. Fetch score adjustments (manual overrides) ──
  const { data: adjustments } = await supabase
    .from('score_adjustments')
    .select('round_number, team_id, correct_score');
  const overrideScores: Record<string, number> = {};
  adjustments?.forEach((a: { round_number: number; team_id: number; correct_score: number }) => {
    overrideScores[`${a.round_number}-${a.team_id}`] = Number(a.correct_score);
  });

  // ── 6. Resolve scores: override > matchup > lineup ──
  const teamRoundScores: Record<string, number> = {};
  for (const round of scoredRounds) {
    for (const team of TEAMS) {
      const key = `${round}-${team.team_id}`;
      const override = overrideScores[key];
      const matchup = matchupScores[key];
      const lineup = Math.round(lineupSums[key] || 0);

      if (override !== undefined) teamRoundScores[key] = Math.round(override);
      else if (matchup !== undefined) teamRoundScores[key] = Math.round(matchup);
      else teamRoundScores[key] = lineup;
    }
  }

  // ── 7. This Week score + rank ──
  const thisWeekScores = new Map<number, number>();
  if (latestScoredRound) {
    for (const team of TEAMS) {
      thisWeekScores.set(
        team.team_id,
        teamRoundScores[`${latestScoredRound}-${team.team_id}`] || 0
      );
    }
  }
  const sortedThisWeek = [...thisWeekScores.entries()].sort((a, b) => b[1] - a[1]);
  const thisWeekRanks = new Map<number, number>();
  sortedThisWeek.forEach(([tid], i) => thisWeekRanks.set(tid, i + 1));

  // ── 8. Season total + rank ──
  const seasonTotals = new Map<number, number>();
  for (const team of TEAMS) {
    let total = 0;
    for (const round of scoredRounds) {
      total += teamRoundScores[`${round}-${team.team_id}`] || 0;
    }
    seasonTotals.set(team.team_id, total);
  }
  const sortedSeason = [...seasonTotals.entries()].sort((a, b) => b[1] - a[1]);
  const seasonRanks = new Map<number, number>();
  sortedSeason.forEach(([tid], i) => seasonRanks.set(tid, i + 1));

  // ── 9. Line totals per round per team (only scored rounds) ──
  const lineByRoundTeam = new Map<string, Record<string, number>>();
  for (const p of allPlayerRounds) {
    if (!p.is_scoring || p.points == null) continue;
    const pos = p.pos.toUpperCase();
    if (!['DEF', 'MID', 'FWD', 'RUC', 'UTL'].includes(pos)) continue;
    const key = `${p.round_number}-${p.team_id}`;
    if (!lineByRoundTeam.has(key)) {
      lineByRoundTeam.set(key, { DEF: 0, MID: 0, FWD: 0, RUC: 0, UTL: 0 });
    }
    lineByRoundTeam.get(key)![pos] += Number(p.points);
  }

  // ── 10. Season line averages + rank ──
  const LINE_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC', 'UTL'] as const;
  const seasonLineAvgs = new Map<number, Record<string, number>>();
  for (const team of TEAMS) {
    const avgs: Record<string, number> = { DEF: 0, MID: 0, FWD: 0, RUC: 0, UTL: 0 };
    for (const pos of LINE_POSITIONS) {
      const vals = scoredRounds.map(
        (r) => lineByRoundTeam.get(`${r}-${team.team_id}`)?.[pos] || 0
      );
      avgs[pos] =
        vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    seasonLineAvgs.set(team.team_id, avgs);
  }

  const lineRanksMap = new Map<number, Record<string, number>>();
  for (const pos of LINE_POSITIONS) {
    const sorted = TEAMS.map((t) => ({
      tid: t.team_id,
      avg: seasonLineAvgs.get(t.team_id)?.[pos] || 0,
    })).sort((a, b) => b.avg - a.avg);
    sorted.forEach((entry, i) => {
      if (!lineRanksMap.has(entry.tid)) lineRanksMap.set(entry.tid, {});
      lineRanksMap.get(entry.tid)![pos] = i + 1;
    });
  }

  // ── 11. Record + ladder from team_snapshots ──
  const { data: snapshots } = await supabase
    .from('team_snapshots')
    .select('team_id, wins, losses, ties, league_rank')
    .eq('round_number', pwrnkgsRoundNumber);
  const snapMap = new Map<
    number,
    { wins: number; losses: number; ties: number; league_rank: number | null }
  >();
  snapshots?.forEach(
    (s: {
      team_id: number;
      wins: number;
      losses: number;
      ties: number;
      league_rank: number | null;
    }) => snapMap.set(s.team_id, s)
  );

  // ── 12. Luck (expected wins vs actual wins) ──
  const validRounds = scoredRounds.filter((round) => {
    const count = TEAMS.filter(
      (t) => (teamRoundScores[`${round}-${t.team_id}`] || 0) > 500
    ).length;
    return count >= 8;
  });

  const luckScores: { teamId: number; luck: number }[] = [];
  for (const team of TEAMS) {
    const snap = snapMap.get(team.team_id);
    if (!snap) {
      luckScores.push({ teamId: team.team_id, luck: 0 });
      continue;
    }
    let totalExpected = 0;
    for (const round of validRounds) {
      const myScore = teamRoundScores[`${round}-${team.team_id}`] || 0;
      let teamsOutscored = 0;
      for (const other of TEAMS) {
        if (other.team_id === team.team_id) continue;
        const otherScore = teamRoundScores[`${round}-${other.team_id}`] || 0;
        if (myScore > otherScore) teamsOutscored += 1;
        else if (myScore === otherScore) teamsOutscored += 0.5;
      }
      totalExpected += teamsOutscored / 9;
    }
    const actualWins = (snap.wins || 0) + 0.5 * (snap.ties || 0);
    luckScores.push({
      teamId: team.team_id,
      luck: Math.round((actualWins - totalExpected) * 100) / 100,
    });
  }
  luckScores.sort((a, b) => b.luck - a.luck);
  const luckMap = new Map<number, { score: number; rank: number }>();
  luckScores.forEach((ls, i) =>
    luckMap.set(ls.teamId, { score: ls.luck, rank: i + 1 })
  );

  // ── 13. Build result ──
  const result = new Map<number, SlideTeamData>();
  for (const team of TEAMS) {
    const snap = snapMap.get(team.team_id);
    const lr = lineRanksMap.get(team.team_id);
    const luck = luckMap.get(team.team_id);

    result.set(team.team_id, {
      scoreThisWeek: latestScoredRound
        ? thisWeekScores.get(team.team_id) ?? null
        : null,
      scoreThisWeekRank: latestScoredRound
        ? thisWeekRanks.get(team.team_id) ?? null
        : null,
      seasonTotal: seasonTotals.get(team.team_id) ?? null,
      seasonTotalRank: seasonRanks.get(team.team_id) ?? null,
      record: {
        wins: snap?.wins || 0,
        losses: snap?.losses || 0,
        ties: snap?.ties || 0,
      },
      ladderPosition: snap?.league_rank ?? null,
      luckScore: luck?.score ?? null,
      luckRank: luck?.rank ?? null,
      lineRanks: {
        def: lr?.DEF ?? null,
        mid: lr?.MID ?? null,
        fwd: lr?.FWD ?? null,
        ruc: lr?.RUC ?? null,
        utl: lr?.UTL ?? null,
      },
    });
  }

  return result;
}
