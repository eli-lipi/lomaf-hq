/**
 * Round-over-round lineup diff: who came onto each team and who went off,
 * compared against the previous round. Includes bench/emergency players —
 * any player_id present on a team in one round and absent in the other.
 */

export interface LineupChange {
  player_id: number;
  player_name: string;
  pos: string;
}

export interface LineupDiff {
  ins: LineupChange[];
  outs: LineupChange[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

// Sort order for positions so the lists read like an AFL team sheet.
const POS_ORDER = ['DEF', 'MID', 'RUC', 'FWD', 'UTL', 'BN', 'EMG'];
function posSortKey(pos: string): number {
  const idx = POS_ORDER.indexOf((pos || '').toUpperCase());
  return idx === -1 ? POS_ORDER.length : idx;
}

function sortChanges(list: LineupChange[]): LineupChange[] {
  return [...list].sort((a, b) => {
    const pa = posSortKey(a.pos);
    const pb = posSortKey(b.pos);
    if (pa !== pb) return pa - pb;
    return a.player_name.localeCompare(b.player_name);
  });
}

/**
 * Computes ins/outs for every team between roundNumber and roundNumber-1.
 * Returns an empty map when there is no prior round to diff against.
 */
export async function computeLineupDiff(
  supabase: SupabaseAny,
  roundNumber: number
): Promise<Map<number, LineupDiff>> {
  const result = new Map<number, LineupDiff>();
  if (roundNumber <= 1) return result;

  type Row = { team_id: number; player_id: number; player_name: string; pos: string };

  async function fetchRound(round: number): Promise<Row[]> {
    const rows: Row[] = [];
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from('player_rounds')
        .select('team_id, player_id, player_name, pos')
        .eq('round_number', round)
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }
    return rows;
  }

  const [prevRows, currRows] = await Promise.all([
    fetchRound(roundNumber - 1),
    fetchRound(roundNumber),
  ]);

  const byTeam = (rows: Row[]) => {
    const m = new Map<number, Map<number, LineupChange>>();
    for (const r of rows) {
      if (!m.has(r.team_id)) m.set(r.team_id, new Map());
      m.get(r.team_id)!.set(r.player_id, { player_id: r.player_id, player_name: r.player_name, pos: r.pos });
    }
    return m;
  };

  const prev = byTeam(prevRows);
  const curr = byTeam(currRows);

  const teamIds = new Set<number>([...prev.keys(), ...curr.keys()]);
  for (const teamId of teamIds) {
    const prevMap = prev.get(teamId) ?? new Map<number, LineupChange>();
    const currMap = curr.get(teamId) ?? new Map<number, LineupChange>();

    const ins: LineupChange[] = [];
    for (const [pid, change] of currMap) {
      if (!prevMap.has(pid)) ins.push(change);
    }
    const outs: LineupChange[] = [];
    for (const [pid, change] of prevMap) {
      if (!currMap.has(pid)) outs.push(change);
    }

    result.set(teamId, { ins: sortChanges(ins), outs: sortChanges(outs) });
  }

  return result;
}
