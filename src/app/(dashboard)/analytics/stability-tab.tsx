'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';

const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#1A56DB', 3194005: '#DC2626', 3194009: '#16A34A', 3194003: '#F59E0B',
  3194006: '#9333EA', 3194010: '#0891B2', 3194008: '#EA580C', 3194001: '#DB2777',
  3194004: '#4F46E5', 3194007: '#059669',
};

interface RosterChangeRow {
  team_id: number;
  team_name: string;
  coach: string;
  totalChanges: number;
  avgPerRound: number;
  rocks: { player_id: number; player_name: string }[];
  perRound: { round: number; changes: number }[];
}

export default function StabilityTab() {
  const [data, setData] = useState<RosterChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rounds, setRounds] = useState<number[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      // Fetch all player_rounds (paginated)
      const allRows: { round_number: number; team_id: number; player_id: number; player_name: string }[] = [];
      let offset = 0;
      while (true) {
        const { data: batch } = await supabase
          .from('player_rounds')
          .select('round_number, team_id, player_id, player_name')
          .range(offset, offset + 999);
        if (!batch || batch.length === 0) break;
        allRows.push(...batch);
        if (batch.length < 1000) break;
        offset += 1000;
      }

      if (allRows.length === 0) { setLoading(false); return; }

      // Group player_ids by (team_id, round_number)
      const rosterMap = new Map<string, Set<number>>();
      const playerNames = new Map<number, string>();
      for (const row of allRows) {
        const key = `${row.team_id}-${row.round_number}`;
        if (!rosterMap.has(key)) rosterMap.set(key, new Set());
        rosterMap.get(key)!.add(row.player_id);
        playerNames.set(row.player_id, row.player_name);
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

          // Players added (in curr but not prev) + players dropped (in prev but not curr)
          let changes = 0;
          for (const pid of currRoster) {
            if (!prevRoster.has(pid)) changes++;
          }
          for (const pid of prevRoster) {
            if (!currRoster.has(pid)) changes++;
          }

          perRound.push({ round: allRounds[i], changes });
          totalChanges += changes;
        }

        // Rocks: players present in EVERY round for this team
        const rocks: { player_id: number; player_name: string }[] = [];
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
              rocks.push({ player_id: pid, player_name: playerNames.get(pid) || `#${pid}` });
            }
          }
        }

        results.push({
          team_id: team.team_id,
          team_name: team.team_name,
          coach: team.coach,
          totalChanges,
          avgPerRound: allRounds.length > 1 ? Math.round((totalChanges / (allRounds.length - 1)) * 10) / 10 : 0,
          rocks: rocks.sort((a, b) => a.player_name.localeCompare(b.player_name)),
          perRound,
        });
      }

      // Sort by total changes descending (most volatile first)
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
