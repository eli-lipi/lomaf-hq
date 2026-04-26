'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { cleanPositionDisplay } from '@/lib/trades/positions';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';

const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#1A56DB', 3194005: '#DC2626', 3194009: '#16A34A', 3194003: '#F59E0B',
  3194006: '#9333EA', 3194010: '#0891B2', 3194008: '#EA580C', 3194001: '#DB2777',
  3194004: '#4F46E5', 3194007: '#059669',
};

// "Real" positions only — UTL/BN are lineup slots, not positions.
type Pos = 'DEF' | 'MID' | 'FWD' | 'RUC';
const POSITIONS: Pos[] = ['DEF', 'MID', 'FWD', 'RUC'];
const POSITION_COLORS: Record<Pos, string> = {
  DEF: '#1A56DB',  // blue
  MID: '#16A34A',  // green
  FWD: '#DC2626',  // red
  RUC: '#9333EA',  // purple
};

interface RockPlayer {
  player_id: number;
  player_name: string;
  position: Pos | null;     // normalized — DEF/MID/FWD/RUC, or null if DPP can't resolve
  raw_position: string | null;
  draft_pick: number | null;
  total_points: number;
  rounds_played: number;
  average: number;
}

interface RosterChangeRow {
  team_id: number;
  team_name: string;
  coach: string;
  totalChanges: number;
  avgPerRound: number;
  rocks: RockPlayer[];
  perRound: { round: number; changes: number }[];
}

/** Pick the rarer side of a DPP (RUC > FWD > DEF > MID). UTL/BN never count. */
function normalizeRockPosition(raw: string | null): Pos | null {
  const cleaned = cleanPositionDisplay(raw);
  if (!cleaned) return null;
  const RARITY: Pos[] = ['RUC', 'FWD', 'DEF', 'MID'];
  const parts = cleaned.toUpperCase().split(/[\/,\s]+/).filter(Boolean);
  let best: Pos | null = null;
  let bestIdx = Infinity;
  for (const p of parts) {
    const idx = (RARITY as readonly string[]).indexOf(p);
    if (idx >= 0 && idx < bestIdx) {
      best = p as Pos;
      bestIdx = idx;
    }
  }
  return best;
}

export default function StabilityTab() {
  const [data, setData] = useState<RosterChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setRounds] = useState<number[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
  // Rocks chart: which team's rock detail is expanded, and which positions show
  const [rocksExpanded, setRocksExpanded] = useState<number | null>(null);
  const [posFilter, setPosFilter] = useState<'all' | Pos>('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      // 1. Fetch all player_rounds — round, team, player, name, points, pos
      const allRows: {
        round_number: number;
        team_id: number;
        player_id: number;
        player_name: string;
        points: number | null;
        pos: string | null;
      }[] = [];
      let offset = 0;
      while (true) {
        const { data: batch } = await supabase
          .from('player_rounds')
          .select('round_number, team_id, player_id, player_name, points, pos')
          .range(offset, offset + 999);
        if (!batch || batch.length === 0) break;
        allRows.push(...batch);
        if (batch.length < 1000) break;
        offset += 1000;
      }

      if (allRows.length === 0) { setLoading(false); return; }

      // 2. Fetch draft_picks — for stable position + pick number per player
      const { data: draftRows } = await supabase
        .from('draft_picks')
        .select('player_id, position, overall_pick');
      const draftPosByPlayer = new Map<number, string>();
      const draftPickByPlayer = new Map<number, number>();
      for (const d of (draftRows ?? []) as { player_id: number; position: string | null; overall_pick: number | null }[]) {
        if (d.position) draftPosByPlayer.set(d.player_id, d.position);
        if (d.overall_pick != null) draftPickByPlayer.set(d.player_id, d.overall_pick);
      }

      // 3. Group player_ids by (team_id, round_number) and accumulate points
      const rosterMap = new Map<string, Set<number>>();
      const playerNames = new Map<number, string>();
      // points per (team_id, player_id) — only counts rounds the player was on this team
      const pointsByTeamPlayer = new Map<string, { total: number; played: number }>();
      // Best raw position fallback if not in draft_picks
      const playerRoundPosFallback = new Map<number, string>();
      for (const row of allRows) {
        const key = `${row.team_id}-${row.round_number}`;
        if (!rosterMap.has(key)) rosterMap.set(key, new Set());
        rosterMap.get(key)!.add(row.player_id);
        playerNames.set(row.player_id, row.player_name);

        const tpKey = `${row.team_id}-${row.player_id}`;
        if (!pointsByTeamPlayer.has(tpKey)) pointsByTeamPlayer.set(tpKey, { total: 0, played: 0 });
        if (row.points != null) {
          const e = pointsByTeamPlayer.get(tpKey)!;
          e.total += Number(row.points);
          e.played += 1;
        }

        // Cache a non-BN/UTL position as fallback — first one we see wins
        if (!playerRoundPosFallback.has(row.player_id)) {
          const cleaned = cleanPositionDisplay(row.pos);
          if (cleaned) playerRoundPosFallback.set(row.player_id, cleaned);
        }
      }

      const allRounds = [...new Set(allRows.map(r => r.round_number))].sort((a, b) => a - b);
      setRounds(allRounds);

      const results: RosterChangeRow[] = [];

      for (const team of TEAMS) {
        const perRound: { round: number; changes: number }[] = [];
        let totalChanges = 0;

        for (let i = 1; i < allRounds.length; i++) {
          const prevKey = `${team.team_id}-${allRounds[i - 1]}`;
          const currKey = `${team.team_id}-${allRounds[i]}`;
          const prevRoster = rosterMap.get(prevKey) || new Set();
          const currRoster = rosterMap.get(currKey) || new Set();

          let changes = 0;
          for (const pid of currRoster) if (!prevRoster.has(pid)) changes++;
          for (const pid of prevRoster) if (!currRoster.has(pid)) changes++;

          perRound.push({ round: allRounds[i], changes });
          totalChanges += changes;
        }

        // Rocks: players present in EVERY round for this team
        const rocks: RockPlayer[] = [];
        const firstRoundKey = `${team.team_id}-${allRounds[0]}`;
        const firstRoster = rosterMap.get(firstRoundKey);
        if (firstRoster) {
          for (const pid of firstRoster) {
            let inAll = true;
            for (const round of allRounds) {
              const roster = rosterMap.get(`${team.team_id}-${round}`);
              if (!roster || !roster.has(pid)) { inAll = false; break; }
            }
            if (inAll) {
              const rawPos = draftPosByPlayer.get(pid) ?? playerRoundPosFallback.get(pid) ?? null;
              const stats = pointsByTeamPlayer.get(`${team.team_id}-${pid}`) ?? { total: 0, played: 0 };
              rocks.push({
                player_id: pid,
                player_name: playerNames.get(pid) || `#${pid}`,
                position: normalizeRockPosition(rawPos),
                raw_position: rawPos,
                draft_pick: draftPickByPlayer.get(pid) ?? null,
                total_points: stats.total,
                rounds_played: stats.played,
                average: stats.played > 0 ? Math.round((stats.total / stats.played) * 10) / 10 : 0,
              });
            }
          }
        }

        results.push({
          team_id: team.team_id,
          team_name: team.team_name,
          coach: team.coach,
          totalChanges,
          avgPerRound: allRounds.length > 1 ? Math.round((totalChanges / (allRounds.length - 1)) * 10) / 10 : 0,
          rocks: rocks.sort((a, b) => (b.total_points - a.total_points) || a.player_name.localeCompare(b.player_name)),
          perRound,
        });
      }

      results.sort((a, b) => b.totalChanges - a.totalChanges);
      setData(results);
    } catch (err) {
      console.error('Failed to load stability data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading team stability data...</div>;
  }

  if (data.length === 0) {
    return <div className="py-12 text-center text-muted-foreground">Upload at least 2 rounds of lineups to see stability data.</div>;
  }

  // Bar chart: total changes per team
  const barData = data.map(d => ({
    name: d.team_name.length > 18 ? d.team_name.slice(0, 16) + '…' : d.team_name,
    fullName: d.team_name,
    changes: d.totalChanges,
    team_id: d.team_id,
    avg: d.avgPerRound,
  }));

  // Per-round stacked data for the selected team's breakdown
  const selectedRow = selectedTeam ? data.find(d => d.team_id === selectedTeam) : null;

  // Summary stats
  const mostVolatile = data[0];
  const mostStable = data[data.length - 1];
  const mostRocks = [...data].sort((a, b) => b.rocks.length - a.rocks.length)[0];

  // ── Rocks chart data ──────────────────────────────────────────
  // Sorted by total rocks (descending), with one row per team. When the
  // position filter is "all", the row shows DEF/MID/FWD/RUC stacked. When
  // a single position is picked, only that count is rendered (single bar).
  const rocksByTeam = [...data]
    .map((d) => {
      const counts: Record<Pos, number> = { DEF: 0, MID: 0, FWD: 0, RUC: 0 };
      for (const r of d.rocks) {
        if (r.position) counts[r.position]++;
      }
      const total = d.rocks.length;
      const filtered =
        posFilter === 'all'
          ? total
          : counts[posFilter];
      return {
        name: d.team_name.length > 18 ? d.team_name.slice(0, 16) + '…' : d.team_name,
        fullName: d.team_name,
        team_id: d.team_id,
        total,
        filtered,
        ...counts,
      };
    })
    .sort((a, b) => b.filtered - a.filtered);

  const rocksDetailRow = rocksExpanded ? data.find((d) => d.team_id === rocksExpanded) : null;
  const filteredRocks =
    rocksDetailRow
      ? posFilter === 'all'
        ? rocksDetailRow.rocks
        : rocksDetailRow.rocks.filter((r) => r.position === posFilter)
      : [];

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <p className="text-xs text-muted-foreground mb-1">Most Active (Volatile)</p>
          <p className="font-bold text-lg" style={{ color: TEAM_COLOR_MAP[mostVolatile.team_id] }}>
            {mostVolatile.team_name}
          </p>
          <p className="text-sm text-muted-foreground">{mostVolatile.totalChanges} total changes ({mostVolatile.avgPerRound}/round)</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <p className="text-xs text-muted-foreground mb-1">Most Stable (Loyal)</p>
          <p className="font-bold text-lg" style={{ color: TEAM_COLOR_MAP[mostStable.team_id] }}>
            {mostStable.team_name}
          </p>
          <p className="text-sm text-muted-foreground">{mostStable.totalChanges} total changes ({mostStable.avgPerRound}/round)</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <p className="text-xs text-muted-foreground mb-1">Most Rocks (Since R1)</p>
          <p className="font-bold text-lg" style={{ color: TEAM_COLOR_MAP[mostRocks.team_id] }}>
            {mostRocks.team_name}
          </p>
          <p className="text-sm text-muted-foreground">{mostRocks.rocks.length} players held since R1</p>
        </div>
      </div>

      {/* Total Changes Bar Chart */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
        <h3 className="font-semibold text-sm mb-4">Total Roster Changes (Season)</h3>
        <p className="text-xs text-muted-foreground mb-4">Players added + dropped between consecutive rounds. Click a bar to see round-by-round breakdown.</p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={barData} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 11 }} />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Tooltip
              formatter={(value: any, _name: any, props: any) => [
                `${value} changes (${props.payload.avg}/round)`,
                props.payload.fullName,
              ]}
            />
            <Bar
              dataKey="changes"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={(entry: any) => setSelectedTeam(entry?.team_id === selectedTeam ? null : entry?.team_id)}
            >
              {barData.map((entry) => (
                <Cell
                  key={entry.team_id}
                  fill={TEAM_COLOR_MAP[entry.team_id] || '#6B7280'}
                  opacity={selectedTeam && selectedTeam !== entry.team_id ? 0.3 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-round breakdown for selected team */}
      {selectedRow && (
        <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
          <h3 className="font-semibold text-sm mb-1">
            Round-by-Round Changes:{' '}
            <span style={{ color: TEAM_COLOR_MAP[selectedRow.team_id] }}>{selectedRow.team_name}</span>
          </h3>
          <p className="text-xs text-muted-foreground mb-4">{selectedRow.coach}</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={selectedRow.perRound} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="round" tickFormatter={(r: number) => `R${r}`} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip
                labelFormatter={(r: any) => `Round ${r}`}
                formatter={(value: any) => [`${value} changes`, 'Roster changes']}
              />
              <Bar dataKey="changes" radius={[4, 4, 0, 0]}>
                {selectedRow.perRound.map((entry) => (
                  <Cell
                    key={entry.round}
                    fill={TEAM_COLOR_MAP[selectedRow.team_id] || '#6B7280'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Rocks chart ──────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
          <div>
            <h3 className="font-semibold text-sm">Rocks per Team</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Players held on the roster every single round since R1. Click a bar to see who they are.
            </p>
          </div>
          {/* Position filter pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground mr-1">Position:</span>
            <PosPill label="All" active={posFilter === 'all'} onClick={() => setPosFilter('all')} />
            {POSITIONS.map((p) => (
              <PosPill
                key={p}
                label={p}
                color={POSITION_COLORS[p]}
                active={posFilter === p}
                onClick={() => setPosFilter(p)}
              />
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={rocksByTeam} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => [`${value}`, name]}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              labelFormatter={(_label: any, payload: any) => payload?.[0]?.payload?.fullName ?? ''}
            />
            {posFilter === 'all' ? (
              <>
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                {/* Stacked bar — one segment per position */}
                {POSITIONS.map((p) => (
                  <Bar
                    key={p}
                    dataKey={p}
                    name={p}
                    stackId="rocks"
                    fill={POSITION_COLORS[p]}
                    cursor="pointer"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(entry: any) =>
                      setRocksExpanded(entry?.team_id === rocksExpanded ? null : entry?.team_id)
                    }
                  />
                ))}
              </>
            ) : (
              <Bar
                dataKey="filtered"
                name={posFilter}
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onClick={(entry: any) =>
                  setRocksExpanded(entry?.team_id === rocksExpanded ? null : entry?.team_id)
                }
              >
                {rocksByTeam.map((entry) => (
                  <Cell
                    key={entry.team_id}
                    fill={POSITION_COLORS[posFilter]}
                    opacity={rocksExpanded && rocksExpanded !== entry.team_id ? 0.3 : 1}
                  />
                ))}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>

        {/* Detail table for the expanded team's rocks */}
        {rocksDetailRow && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="flex items-baseline justify-between mb-3">
              <h4 className="font-semibold text-sm">
                Rocks:{' '}
                <span style={{ color: TEAM_COLOR_MAP[rocksDetailRow.team_id] }}>
                  {rocksDetailRow.team_name}
                </span>
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  ({filteredRocks.length}
                  {posFilter !== 'all' && ` ${posFilter}`} of {rocksDetailRow.rocks.length})
                </span>
              </h4>
              <button
                onClick={() => setRocksExpanded(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Player</th>
                    <th className="py-2 pr-4 font-medium">Pos</th>
                    <th className="py-2 pr-4 font-medium text-right">Draft Pick</th>
                    <th className="py-2 pr-4 font-medium text-right">Avg</th>
                    <th className="py-2 font-medium text-right">Total Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRocks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-3 text-center text-xs italic text-muted-foreground">
                        No {posFilter !== 'all' ? posFilter : ''} rocks for this team.
                      </td>
                    </tr>
                  )}
                  {filteredRocks.map((r) => (
                    <tr key={r.player_id} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium">{r.player_name}</td>
                      <td className="py-2 pr-4">
                        {r.position ? (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                            style={{ backgroundColor: POSITION_COLORS[r.position] }}
                          >
                            {r.position}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {r.draft_pick != null ? `#${r.draft_pick}` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums font-medium">
                        {r.rounds_played > 0 ? r.average.toFixed(0) : '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums">{r.total_points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Rocks + Full table */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm overflow-x-auto">
        <h3 className="font-semibold text-sm mb-1">Roster Stability Leaderboard</h3>
        <p className="text-xs text-muted-foreground mb-4">
          <strong>Rocks</strong> = players on the roster every round since R1. A high rock count with few changes signals a coach who trusts their draft.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-4 font-medium text-muted-foreground">#</th>
              <th className="py-2 pr-4 font-medium text-muted-foreground">Team</th>
              <th className="py-2 pr-4 font-medium text-muted-foreground">Coach</th>
              <th className="py-2 pr-4 font-medium text-muted-foreground text-right">Changes</th>
              <th className="py-2 pr-4 font-medium text-muted-foreground text-right">Avg/Rd</th>
              <th className="py-2 pr-4 font-medium text-muted-foreground text-right">Rocks</th>
              <th className="py-2 font-medium text-muted-foreground">Rock Players</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={row.team_id}
                className={cn(
                  'border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors',
                  selectedTeam === row.team_id && 'bg-muted/50'
                )}
                onClick={() => setSelectedTeam(row.team_id === selectedTeam ? null : row.team_id)}
              >
                <td className="py-2.5 pr-4 font-medium text-muted-foreground">{i + 1}</td>
                <td className="py-2.5 pr-4">
                  <span className="font-medium" style={{ color: TEAM_COLOR_MAP[row.team_id] }}>
                    {row.team_name}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{row.coach}</td>
                <td className="py-2.5 pr-4 text-right font-mono font-medium">{row.totalChanges}</td>
                <td className="py-2.5 pr-4 text-right font-mono">{row.avgPerRound}</td>
                <td className="py-2.5 pr-4 text-right font-mono font-medium">{row.rocks.length}</td>
                <td className="py-2.5 text-xs text-muted-foreground max-w-[300px] truncate" title={row.rocks.map(r => r.player_name).join(', ')}>
                  {row.rocks.length > 0
                    ? row.rocks.map(r => r.player_name).join(', ')
                    : <span className="italic">None</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PosPill({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors',
        active
          ? 'text-white border-transparent'
          : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/40'
      )}
      style={active ? { backgroundColor: color ?? 'var(--primary)' } : undefined}
    >
      {label}
    </button>
  );
}
