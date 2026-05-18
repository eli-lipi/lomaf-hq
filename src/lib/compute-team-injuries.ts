/**
 * "Who's out for each team this round" — driven by the lineup CSV
 * (player_rounds.points IS NULL ⇒ player did not take the field),
 * with afl_injuries used only to add a "weeks out" badge where one
 * is known. Source-of-truth is player_rounds because the AFL injury
 * scrape is incomplete: well-known injuries like Salem/Rozee/Bergman
 * are routinely missing from afl_injuries, while players who passed
 * a fitness test and played (e.g. Curnow) can linger as stale entries.
 */

export interface InjuredPlayer {
  player_name: string;
  duration_label: string; // '' when unknown
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

// Sort key: numeric weeks first (ascending), then status keywords,
// then unknown (no duration), then by name.
function weight(label: string): number {
  if (!label) return 200;
  if (/^\d+(-\d+)?w$/.test(label)) {
    const n = parseInt(label, 10);
    return isFinite(n) ? n : 99;
  }
  if (label === 'Test' || label === 'Mgd' || label === 'Conc') return 90;
  if (label === 'TBC') return 95;
  if (label === 'Season') return 100;
  return 150;
}

export async function computeTeamInjuries(
  supabase: SupabaseAny,
  roundNumber: number
): Promise<Map<number, InjuredPlayer[]>> {
  const result = new Map<number, InjuredPlayer[]>();

  type RosterRow = {
    team_id: number;
    player_id: number | null;
    player_name: string;
    points: number | null;
  };
  const roster: RosterRow[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('player_rounds')
      .select('team_id, player_id, player_name, points')
      .eq('round_number', roundNumber)
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    roster.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  if (roster.length === 0) return result;

  // Did-not-play = points is null. A 0 might mean played-but-scoreless;
  // null specifically means the player wasn't fielded.
  const dnp = roster.filter(r => r.points === null);
  if (dnp.length === 0) return result;

  // Look up duration context from afl_injuries (best-effort).
  const playerIds = Array.from(new Set(dnp.map(r => r.player_id).filter((id): id is number => id != null)));
  type InjuryRow = {
    player_id: number | null;
    return_min_weeks: number | null;
    return_max_weeks: number | null;
    return_status: string | null;
  };
  let injuryRows: InjuryRow[] = [];
  if (playerIds.length > 0) {
    const { data } = await supabase
      .from('afl_injuries')
      .select('player_id, return_min_weeks, return_max_weeks, return_status')
      .in('player_id', playerIds);
    injuryRows = (data ?? []) as InjuryRow[];
  }
  const byPlayer = new Map<number, InjuryRow>();
  for (const inj of injuryRows) {
    if (inj.player_id != null) byPlayer.set(inj.player_id, inj);
  }

  for (const row of dnp) {
    const inj = row.player_id != null ? byPlayer.get(row.player_id) : undefined;
    if (!result.has(row.team_id)) result.set(row.team_id, []);
    result.get(row.team_id)!.push({
      player_name: row.player_name,
      duration_label: inj ? formatDuration(inj) : '',
    });
  }

  for (const list of result.values()) {
    list.sort((a, b) => {
      const w = weight(a.duration_label) - weight(b.duration_label);
      if (w !== 0) return w;
      return a.player_name.localeCompare(b.player_name);
    });
  }

  return result;
}
