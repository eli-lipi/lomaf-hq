'use client';

import { useState, useEffect, useMemo } from 'react';
import { TEAMS } from '@/lib/constants';
import { cn, formatScore } from '@/lib/utils';
import { fetchResolvedScores } from '@/lib/scores';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import InsightsPanel from '@/components/ai/insights-panel';

const LINE_IDS = ['DEF', 'MID', 'FWD', 'RUC', 'UTL'] as const;

const LINE_COLORS: Record<string, string> = {
  DEF: '#3B82F6',
  MID: '#16A34A',
  FWD: '#F59E0B',
  RUC: '#9333EA',
  UTL: '#EC4899',
};

const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#1A56DB', 3194005: '#DC2626', 3194009: '#16A34A', 3194003: '#F59E0B',
  3194006: '#9333EA', 3194010: '#0891B2', 3194008: '#EA580C', 3194001: '#DB2777',
  3194004: '#4F46E5', 3194007: '#059669',
};

interface PlayerRoundRow {
  round_number: number; team_id: number; pos: string; is_scoring: boolean; points: number | null;
}

interface TeamRangeRow {
  team_name: string; team_id: number;
  total: number; avgPerRound: number; rank: number;
  lines: Record<string, { total: number; rank: number }>;
}

type SortKey = 'total' | 'DEF' | 'MID' | 'FWD' | 'RUC' | 'UTL';

function RankBadge({ rank, size = 'sm' }: { rank: number; size?: 'sm' | 'md' }) {
  const color = rank <= 3 ? 'bg-green-100 text-green-700 border-green-200'
    : rank >= 8 ? 'bg-red-100 text-red-700 border-red-200'
    : 'bg-gray-100 text-gray-600 border-gray-200';
  const sizeClass = size === 'md' ? 'w-7 h-7 text-xs' : 'w-5 h-5 text-[10px]';
  return (
    <span className={cn('inline-flex items-center justify-center rounded-full font-bold border', color, sizeClass)}>
      {rank}
    </span>
  );
}

export default function RoundRangeTab() {
  const [allData, setAllData] = useState<PlayerRoundRow[]>([]);
  const [resolvedScores, setResolvedScores] = useState<Record<string, number>>({});
  const [lineAdj, setLineAdj] = useState<Record<string, Record<string, number>>>({});
  const [validRounds, setValidRounds] = useState<number[]>([]);
  const [fromRound, setFromRound] = useState<number>(0);
  const [toRound, setToRound] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const { teamRoundScores: resolved, lineAdjustments, validRounds: valid, allPlayerRounds } = await fetchResolvedScores();
      // Convert allPlayerRounds to the shape we need
      const allRows: PlayerRoundRow[] = allPlayerRounds.map(r => ({
        round_number: r.round_number, team_id: r.team_id, pos: r.pos, is_scoring: r.is_scoring, points: r.points,
      }));
      setAllData(allRows);
      setResolvedScores(resolved);
      setLineAdj(lineAdjustments);
      setValidRounds(valid);
      if (valid.length > 0) {
        setFromRound(valid[0]);
        setToRound(valid[valid.length - 1]);
      }
    } catch (err) {
      console.error('Failed to load round range data:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectedRounds = useMemo(() => {
    return validRounds.filter(r => r >= fromRound && r <= toRound);
  }, [validRounds, fromRound, toRound]);

  const isSingleRound = selectedRounds.length === 1;

  // Season averages (for single-round comparison)
  const seasonLineAvgs = useMemo(() => {
    if (!isSingleRound) return null;
    const avgs: Record<number, Record<string, number>> = {};
    TEAMS.forEach(t => {
      avgs[t.team_id] = {};
      LINE_IDS.forEach(pos => {
        const roundTotals = validRounds.map(round => {
          return allData.filter(r => r.team_id === t.team_id && r.round_number === round && r.pos === pos && r.is_scoring && r.points != null)
            .reduce((sum, p) => sum + Number(p.points), 0);
        }).filter(s => s > 0);
        avgs[t.team_id][pos] = roundTotals.length > 0 ? Math.round(roundTotals.reduce((a, b) => a + b, 0) / roundTotals.length) : 0;
      });
      // Total season avg
      const totalPerRound = validRounds.map(round => {
        return allData.filter(r => r.team_id === t.team_id && r.round_number === round && r.is_scoring && r.points != null)
          .reduce((sum, p) => sum + Number(p.points), 0);
      }).filter(s => s > 0);
      avgs[t.team_id].TOTAL = totalPerRound.length > 0 ? Math.round(totalPerRound.reduce((a, b) => a + b, 0) / totalPerRound.length) : 0;
    });
    return avgs;
  }, [allData, validRounds, isSingleRound]);

  const tableData = useMemo((): TeamRangeRow[] => {
    if (selectedRounds.length === 0) return [];
    const numRounds = selectedRounds.length;

    const teams = TEAMS.map(team => {
      const lines: Record<string, { total: number; rank: number }> = {};
      LINE_IDS.forEach(pos => {
        let total = selectedRounds.reduce((sum, round) => {
          const players = allData.filter(r => r.team_id === team.team_id && r.round_number === round && r.pos === pos && r.is_scoring && r.points != null);
          return sum + players.reduce((s, p) => s + Number(p.points), 0);
        }, 0);
        // Apply line adjustments from score_adjustments
        selectedRounds.forEach(round => {
          const adj = lineAdj[`${round}-${team.team_id}`];
          if (adj && adj[pos]) total += adj[pos];
        });
        lines[pos] = { total: Math.round(total), rank: 0 };
      });

      // Use resolved scores for the total (not just the sum of lines)
      const total = selectedRounds.reduce((sum, round) => {
        return sum + (resolvedScores[`${round}-${team.team_id}`] || 0);
      }, 0);
      return {
        team_name: team.team_name, team_id: team.team_id,
        total: Math.round(total), avgPerRound: Math.round(total / numRounds), rank: 0, lines,
      };
    });

    // Rank by total
    teams.sort((a, b) => b.total - a.total);
    teams.forEach((t, i) => { t.rank = i + 1; });

    // Rank per line
    LINE_IDS.forEach(pos => {
      const sorted = [...teams].sort((a, b) => b.lines[pos].total - a.lines[pos].total);
      sorted.forEach((t, i) => { t.lines[pos].rank = i + 1; });
    });

    return teams;
  }, [allData, selectedRounds, resolvedScores, lineAdj]);

  // Apply user sort
  const sortedData = useMemo(() => {
    const data = [...tableData];
    data.sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortKey === 'total') {
        aVal = a.total; bVal = b.total;
      } else {
        aVal = a.lines[sortKey]?.total || 0; bVal = b.lines[sortKey]?.total || 0;
      }
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
    return data;
  }, [tableData, sortKey, sortAsc]);

  // Stacked bar chart data (sorted by total)
  const chartData = useMemo(() => {
    return tableData.map(t => {
      const row: Record<string, unknown> = { team: t.team_name, team_id: t.team_id };
      LINE_IDS.forEach(pos => { row[pos] = t.lines[pos].total; });
      row.total = t.total;
      return row;
    });
  }, [tableData]);

  // Auto-generated insights
  const insights = useMemo(() => {
    if (tableData.length === 0) return [];
    const msgs: string[] = [];
    const roundLabel = isSingleRound ? `R${selectedRounds[0]}` : `R${selectedRounds[0]}-${selectedRounds[selectedRounds.length - 1]}`;
    const best = tableData[0];
    const worst = tableData[tableData.length - 1];

    // Best team
    if (tableData.length >= 2) {
      const gap = best.total - tableData[1].total;
      if (gap > 100) {
        // Find best lines for this team
        const bestLines = LINE_IDS.filter(pos => best.lines[pos].rank <= 2).join(' and ');
        msgs.push(`In ${roundLabel}, ${best.team_name} outscored every team by ${formatScore(gap)}+ points${bestLines ? `, driven by the league's best ${bestLines} lines` : ''}.`);
      }
    }

    // Worst line per position
    LINE_IDS.forEach(pos => {
      const worstInPos = [...tableData].sort((a, b) => a.lines[pos].total - b.lines[pos].total)[0];
      const bestInPos = [...tableData].sort((a, b) => b.lines[pos].total - a.lines[pos].total)[0];
      const posGap = bestInPos.lines[pos].total - worstInPos.lines[pos].total;
      if (posGap > 200 && worstInPos.lines[pos].rank === 10) {
        msgs.push(`${worstInPos.team_name}'s ${pos} line ranked 10th in ${roundLabel}, scoring ${formatScore(posGap)} fewer points than ${bestInPos.team_name}'s league-leading ${pos}.`);
      }
    });

    // Single-round comparison to season avg
    if (isSingleRound && seasonLineAvgs) {
      TEAMS.forEach(t => {
        const teamRow = tableData.find(tr => tr.team_id === t.team_id);
        if (!teamRow) return;
        const seasonAvg = seasonLineAvgs[t.team_id].TOTAL;
        if (seasonAvg > 0) {
          const pctDiff = Math.round(((teamRow.total - seasonAvg) / seasonAvg) * 100);
          if (Math.abs(pctDiff) >= 12) {
            msgs.push(`${t.team_name} scored ${formatScore(teamRow.total)} this week — ${pctDiff > 0 ? `${pctDiff}% above` : `${Math.abs(pctDiff)}% below`} their season average of ${formatScore(seasonAvg)}.`);
          }
        }
      });
    }

    // Line carrying a team
    if (!isSingleRound) {
      tableData.forEach(t => {
        LINE_IDS.forEach(pos => {
          if (t.lines[pos].rank <= 2 && t.rank >= 7) {
            msgs.push(`${t.team_name} ranks ${t.rank}th overall despite having the league's #${t.lines[pos].rank} ${pos} line — their other lines are dragging them down.`);
          }
        });
      });
    }

    // UTL standout
    const bestUtl = [...tableData].sort((a, b) => b.lines.UTL.total - a.lines.UTL.total)[0];
    if (bestUtl.lines.UTL.rank === 1 && selectedRounds.length > 0) {
      const utlAvg = Math.round(bestUtl.lines.UTL.total / selectedRounds.length);
      if (utlAvg > 90) {
        msgs.push(`${bestUtl.team_name}'s UTL slot has been the most productive in the league, averaging ${utlAvg} per round.`);
      }
    }

    return msgs.slice(0, 5);
  }, [tableData, selectedRounds, isSingleRound, seasonLineAvgs]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortAsc ? ' ↑' : ' ↓';
  };

  if (loading) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Loading round data...</p></div>;
  if (allData.length === 0) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Upload round data to see round range analysis.</p></div>;

  return (
    <div className="space-y-6">
      {/* Round Range Selector */}
      <div className="bg-card border border-border rounded-lg shadow-sm p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground">From</label>
            <select
              value={fromRound}
              onChange={(e) => {
                const v = Number(e.target.value);
                setFromRound(v);
                if (v > toRound) setToRound(v);
              }}
              className="border border-border rounded-md px-3 py-1.5 text-sm bg-background"
            >
              {validRounds.map(r => <option key={r} value={r}>R{r}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground">To</label>
            <select
              value={toRound}
              onChange={(e) => {
                const v = Number(e.target.value);
                setToRound(v);
                if (v < fromRound) setFromRound(v);
              }}
              className="border border-border rounded-md px-3 py-1.5 text-sm bg-background"
            >
              {validRounds.map(r => <option key={r} value={r}>R{r}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setFromRound(validRounds[0]); setToRound(validRounds[validRounds.length - 1]); }}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                fromRound === validRounds[0] && toRound === validRounds[validRounds.length - 1]
                  ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              Full Season
            </button>
            <button
              onClick={() => { const latest = validRounds[validRounds.length - 1]; setFromRound(latest); setToRound(latest); }}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                fromRound === toRound && toRound === validRounds[validRounds.length - 1]
                  ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              This Week
            </button>
          </div>
          <div className="text-sm text-muted-foreground ml-auto">
            {selectedRounds.length === 1 ? `Round ${selectedRounds[0]}` : `${selectedRounds.length} rounds (R${selectedRounds[0]}–R${selectedRounds[selectedRounds.length - 1]})`}
          </div>
        </div>
      </div>

      {/* Main Table */}
      {sortedData.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Team Performance — {isSingleRound ? `Round ${selectedRounds[0]}` : `R${selectedRounds[0]}–R${selectedRounds[selectedRounds.length - 1]}`}</h3>
            <p className="text-xs text-muted-foreground mt-1">Click column headers to sort</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2.5 font-medium text-muted-foreground w-10">#</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Team</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-right cursor-pointer hover:text-foreground" onClick={() => handleSort('total')}>
                    Total{sortIcon('total')}
                  </th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Avg/Rd</th>
                  <th className="px-2 py-2.5 font-medium text-muted-foreground text-center">Rank</th>
                  {LINE_IDS.map(pos => (
                    <th key={pos} colSpan={2} className="px-1 py-2.5 font-medium text-muted-foreground text-center cursor-pointer hover:text-foreground border-l border-border" onClick={() => handleSort(pos)}>
                      {pos}{sortIcon(pos)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedData.map((team, i) => (
                  <tr key={team.team_id} className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TEAM_COLOR_MAP[team.team_id] }} />
                        <span className="font-medium text-sm">{team.team_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold">{formatScore(team.total)}</td>
                    <td className="px-3 py-2.5 text-right">{formatScore(team.avgPerRound)}</td>
                    <td className="px-2 py-2.5 text-center"><RankBadge rank={team.rank} size="md" /></td>
                    {LINE_IDS.map(pos => (
                      <td key={pos} colSpan={2} className="px-1 py-2.5 text-center border-l border-border">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{formatScore(team.lines[pos].total)}</span>
                          <RankBadge rank={team.lines[pos].rank} />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stacked Bar Chart */}
      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-1">Line Breakdown by Team</h3>
          <p className="text-xs text-muted-foreground mb-4">Stacked contribution from each line — {isSingleRound ? `Round ${selectedRounds[0]}` : `R${selectedRounds[0]}–R${selectedRounds[selectedRounds.length - 1]}`}</p>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="team" type="category" width={180} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value, name) => {
                  const v = Number(value) || 0;
                  const n = String(name);
                  const teamRow = tableData.find(t => t.lines[n]?.total === v);
                  const rank = teamRow?.lines[n]?.rank;
                  return [`${formatScore(v)}${rank ? ` (#${rank})` : ''}`, n];
                }}
              />
              {LINE_IDS.map(pos => (
                <Bar key={pos} dataKey={pos} stackId="a" fill={LINE_COLORS[pos]} name={pos} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-3 justify-center">
            {LINE_IDS.map(pos => (
              <div key={pos} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: LINE_COLORS[pos] }} />
                <span className="text-xs text-muted-foreground">{pos}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-3">Key Insights</h3>
          <div className="space-y-2.5">
            {insights.map((msg, i) => (
              <div key={i} className="flex gap-2.5 items-start">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <p className="text-sm text-muted-foreground leading-relaxed">{msg}</p>
              </div>
            ))}
          </div>
          <InsightsPanel
            roundNumber={toRound}
            sectionKey={`round_range_${fromRound}_${toRound}`}
            sectionName={`Round Range (R${fromRound}-R${toRound})`}
            sectionData={{ insights }}
          />
        </div>
      )}
    </div>
  );
}
