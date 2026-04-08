import { supabase } from './supabase';
import { TEAMS } from './constants';

/**
 * Fetches resolved scores for all teams across all rounds.
 * Resolution order: manual override > matchup CSV score > lineup sum.
 * Also returns per-line adjustments for line ranking corrections.
 *
 * Returns: { teamRoundScores, lineAdjustments, validRounds }
 */
export async function fetchResolvedScores(): Promise<{
  teamRoundScores: Record<string, number>; // key: "round-teamId"
  lineAdjustments: Record<string, Record<string, number>>; // key: "round-teamId" -> { DEF: +47, ... }
  validRounds: number[];
  allPlayerRounds: { round_number: number; team_id: number; team_name: string; player_id: number; player_name: string; pos: string; is_scoring: boolean; is_emg: boolean; points: number | null }[];
}> {
  // 1. Fetch all player_rounds (paginated)
  const allPlayerRounds: { round_number: number; team_id: number; team_name: string; player_id: number; player_name: string; pos: string; is_scoring: boolean; is_emg: boolean; points: number | null }[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('player_rounds')
      .select('round_number, team_id, team_name, player_id, player_name, pos, is_scoring, is_emg, points')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allPlayerRounds.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  // 2. Compute lineup sums
  const lineupSums: Record<string, number> = {};
  const roundsSet = new Set<number>();
  allPlayerRounds.forEach(pr => {
    if (!pr.is_scoring || pr.points == null) return;
    const key = `${pr.round_number}-${pr.team_id}`;
    lineupSums[key] = (lineupSums[key] || 0) + Number(pr.points);
    roundsSet.add(pr.round_number);
  });

  // 3. Fetch matchup scores
  const { data: matchups } = await supabase
    .from('matchup_rounds')
    .select('round_number, team_id, score_for');
  const matchupScores: Record<string, number> = {};
  matchups?.forEach(m => {
    matchupScores[`${m.round_number}-${m.team_id}`] = Number(m.score_for);
  });

  // 4. Fetch score adjustments (manual overrides)
  const { data: adjustments } = await supabase
    .from('score_adjustments')
    .select('round_number, team_id, correct_score, adjustment, assigned_line, status');

  const overrideScores: Record<string, number> = {};
  const lineAdjustments: Record<string, Record<string, number>> = {};
  adjustments?.forEach(a => {
    const key = `${a.round_number}-${a.team_id}`;
    // Both confirmed and unconfirmed adjustments apply to scores
    overrideScores[key] = Number(a.correct_score);

    // Line adjustments only if assigned to a specific line
    if (a.assigned_line && a.assigned_line !== 'Unassigned') {
      if (!lineAdjustments[key]) lineAdjustments[key] = {};
      lineAdjustments[key][a.assigned_line] = (lineAdjustments[key][a.assigned_line] || 0) + Number(a.adjustment);
    }
  });

  // 5. Resolve: override > matchup > lineup
  const teamRoundScores: Record<string, number> = {};
  const allRounds = [...roundsSet].sort((a, b) => a - b);

  for (const round of allRounds) {
    for (const team of TEAMS) {
      const key = `${round}-${team.team_id}`;
      const lineup = Math.round(lineupSums[key] || 0);
      const matchup = matchupScores[key];
      const override = overrideScores[key];

      if (override !== undefined) {
        teamRoundScores[key] = Math.round(override);
      } else if (matchup !== undefined) {
        teamRoundScores[key] = Math.round(matchup);
      } else {
        teamRoundScores[key] = lineup;
      }
    }
  }

  // 6. Filter valid rounds (8+ teams with scores > 500)
  const validRounds = allRounds.filter(round => {
    const teamsWithScores = TEAMS.filter(t => (teamRoundScores[`${round}-${t.team_id}`] || 0) > 500).length;
    return teamsWithScores >= 8;
  });

  return { teamRoundScores, lineAdjustments, validRounds, allPlayerRounds };
}
