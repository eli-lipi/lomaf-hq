/**
 * "Who's injured on each team's roster this round" — the intersection of:
 *   1. afl_injuries  (the AFL's official injury list — comprehensive after
 *      the 18-club Indigenous-banner parsing fix)
 *   2. player_rounds with points IS NULL for the round (didn't take the
 *      field — so a player who passed a fitness test and played is dropped
 *      immediately, e.g. Curnow scoring 27pts in R10 despite still being
 *      listed as "Test" in afl_injuries)
 *
 * Players who simply weren't selected (omissions, rests, retirements,
 * AFL byes) have points IS NULL but no afl_injuries row — they're
 * correctly excluded, so Treloar / Pendlebury / etc. don't show up.
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

// Sort key: numeric weeks first (ascending), then status keywords,
// then by name.
function weight(label: string): number {
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

  // Look up the DNP players in afl_injuries. Anyone not present is treated
  // as "not injured" — omissions, rests, byes, retirements all land here.
  const playerIds = Array.from(new Set(dnp.map(r => r.player_id).filter((id): id is number => id != null)));
  if (playerIds.length === 0) return result;

  type InjuryRow = {
    player_id: number | null;
    return_min_weeks: number | null;
    return_max_weeks: number | null;
    return_status: string | null;
  };
  const { data: injuryRowsData } = await supabase
    .from('afl_injuries')
    .select('player_id, return_min_weeks, return_max_weeks, return_status')
    .in('player_id', playerIds);
  const byPlayer = new Map<number, InjuryRow>();
  for (const inj of (injuryRowsData ?? []) as InjuryRow[]) {
    if (inj.player_id != null) byPlayer.set(inj.player_id, inj);
  }

  for (const row of dnp) {
    if (row.player_id == null) continue;
    const inj = byPlayer.get(row.player_id);
    if (!inj) continue; // DNP but not on the AFL injury list — likely a selection call, not an injury
    if (!result.has(row.team_id)) result.set(row.team_id, []);
    result.get(row.team_id)!.push({
      player_name: row.player_name,
      duration_label: formatDuration(inj),
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
