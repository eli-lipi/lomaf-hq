/**
 * For each LOMAF team, find which players on their round-N roster are
 * currently flagged in afl_injuries, with a human-friendly "weeks out"
 * label. Used by the carousel slides to render the INJ chip row.
 */

export interface InjuredPlayer {
  player_name: string;
  duration_label: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

function formatDuration(inj: {
  return_min_weeks: number | null;
  return_max_weeks: number | null;
  return_status: string | null;
}): string {
  const min = inj.return_min_weeks;
  const max = inj.return_max_weeks;
  if (max != null) {
    if (min != null && min !== max) return `${min}-${max}w`;
    return `${max}w`;
  }
  switch (inj.return_status) {
    case 'season': return 'Season';
    case 'indefinite': return 'TBC';
    case 'test': return 'Test';
    case 'managed': return 'Mgd';
    case 'concussion': return 'Conc';
    case 'specific_round': return 'TBC';
    case 'tbc':
    case 'unknown':
    default: return 'TBC';
  }
}

export async function computeTeamInjuries(
  supabase: SupabaseAny,
  roundNumber: number
): Promise<Map<number, InjuredPlayer[]>> {
  const result = new Map<number, InjuredPlayer[]>();

  type RosterRow = { team_id: number; player_id: number };
  const roster: RosterRow[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('player_rounds')
      .select('team_id, player_id')
      .eq('round_number', roundNumber)
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    roster.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  if (roster.length === 0) return result;

  const playerIds = Array.from(new Set(roster.map(r => r.player_id).filter(Boolean)));
  if (playerIds.length === 0) return result;

  type InjuryRow = {
    player_id: number | null;
    player_name: string;
    return_min_weeks: number | null;
    return_max_weeks: number | null;
    return_status: string | null;
  };
  const { data: injuryRows } = await supabase
    .from('afl_injuries')
    .select('player_id, player_name, return_min_weeks, return_max_weeks, return_status')
    .in('player_id', playerIds);

  const byPlayer = new Map<number, InjuryRow>();
  for (const inj of (injuryRows ?? []) as InjuryRow[]) {
    if (inj.player_id != null) byPlayer.set(inj.player_id, inj);
  }

  for (const row of roster) {
    const inj = byPlayer.get(row.player_id);
    if (!inj) continue;
    if (!result.has(row.team_id)) result.set(row.team_id, []);
    result.get(row.team_id)!.push({
      player_name: inj.player_name,
      duration_label: formatDuration(inj),
    });
  }

  // Sort each team's injuries: soonest return first, TBC/Season last, then by name.
  const weight = (label: string): number => {
    if (label.endsWith('w')) {
      const n = parseInt(label, 10);
      return isFinite(n) ? n : 99;
    }
    if (label === 'Test' || label === 'Mgd' || label === 'Conc') return 90;
    if (label === 'TBC') return 95;
    if (label === 'Season') return 100;
    return 99;
  };
  for (const list of result.values()) {
    list.sort((a, b) => {
      const wa = weight(a.duration_label);
      const wb = weight(b.duration_label);
      if (wa !== wb) return wa - wb;
      return a.player_name.localeCompare(b.player_name);
    });
  }

  return result;
}
