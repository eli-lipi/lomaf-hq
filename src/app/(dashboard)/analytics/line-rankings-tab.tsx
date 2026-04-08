'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn, formatScore } from '@/lib/utils';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';

const POSITIONS = [
  { id: 'DEF', label: 'Defence', slots: 5 },
  { id: 'MID', label: 'Midfield', slots: 7 },
  { id: 'RUC', label: 'Ruck', slots: 1 },
  { id: 'FWD', label: 'Forward', slots: 4 },
  { id: 'UTL', label: 'Utility', slots: 1 },
] as const;

type PosId = (typeof POSITIONS)[number]['id'];

const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#1A56DB', 3194005: '#DC2626', 3194009: '#16A34A', 3194003: '#F59E0B',
  3194006: '#9333EA', 3194010: '#0891B2', 3194008: '#EA580C', 3194001: '#DB2777',
  3194004: '#4F46E5', 3194007: '#059669',
};

interface PlayerRoundRow {
  round_number: number; team_id: number; team_name: string; player_id: number;
  player_name: string; pos: string; is_scoring: boolean; is_emg: boolean; points: number | null;
}

interface PlayerBreakdown {
  name: string; avg: number; gp: number; player_id: number;
  role: 'onfield' | 'emg' | 'bench';
}

interface TeamLineStat {
  team_name: string; team_id: number;
  avg: number; total: number; high: number; low: number;
  deltaFromLeagueAvg: number;
  roundScores: { round: number; score: number; rank: number }[];
  players: PlayerBreakdown[];
  onField: PlayerBreakdown[];
  emg: PlayerBreakdown[];
  bench: PlayerBreakdown[];
}

// Rank badge: green 1-3, gray 4-7, red 8-10
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

// Color for average score
function avgColor(avg: number): string {
  if (avg >= 100) return 'text-green-600 font-bold';
  if (avg >= 70) return 'text-yellow-600 font-semibold';
  return 'text-red-600 font-semibold';
}

// Gradient background for value cells
function avgBg(avg: number, leagueAvg: number): string {
  const diff = avg - leagueAvg;
  if (diff > 30) return 'bg-green-100';
  if (diff > 10) return 'bg-green-50';
  if (diff < -30) return 'bg-red-100';
  if (diff < -10) return 'bg-red-50';
  return '';
}

export default function LineRankingsTab() {
  const [activePos, setActivePos] = useState<PosId | 'ALL'>('ALL');
  const [allData, setAllData] = useState<PlayerRoundRow[]>([]);
  const [validRounds, setValidRounds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightTeam, setHighlightTeam] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const allRows: PlayerRoundRow[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('player_rounds')
          .select('round_number, team_id, team_name, player_id, player_name, pos, is_scoring, is_emg, points')
          .range(offset, offset + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
      }
      setAllData(allRows);

      // Filter valid rounds
      const rounds = [...new Set(allRows.map(r => r.round_number))].sort((a, b) => a - b);
      const valid = rounds.filter(round => {
        const teamsWithScores = new Set(
          allRows.filter(r => r.round_number === round && r.is_scoring && r.points != null && Number(r.points) > 0)
            .map(r => r.team_id)
        );
        return teamsWithScores.size >= 8;
      });
      setValidRounds(valid);
    } catch (err) {
      console.error('Failed to load position data:', err);
    } finally {
      setLoading(false);
    }
  };

  // === Cross-position summary (ALL view) ===
  const crossPosSummary = useMemo(() => {
    if (validRounds.length === 0) return [];
    const posIds = ['DEF', 'MID', 'RUC', 'FWD', 'UTL'] as const;

    // For each position + team, compute season average
    const teamPosAvg: Record<string, Record<string, number>> = {};
    TEAMS.forEach(t => {
      teamPosAvg[t.team_name] = {};
      posIds.forEach(pos => {
        const roundTotals = validRounds.map(round => {
          const players = allData.filter(r => r.team_id === t.team_id && r.round_number === round && r.pos === pos && r.is_scoring && r.points != null);
          return players.reduce((sum, p) => sum + Number(p.points), 0);
        });
        const validTotals = roundTotals.filter(s => s > 0);
        teamPosAvg[t.team_name][pos] = validTotals.length > 0 ? Math.round(validTotals.reduce((a, b) => a + b, 0) / validTotals.length) : 0;
      });
    });

    // Rank teams within each position
    const teamPosRank: Record<string, Record<string, number>> = {};
    posIds.forEach(pos => {
      const sorted = TEAMS.map(t => ({ name: t.team_name, avg: teamPosAvg[t.team_name][pos] })).sort((a, b) => b.avg - a.avg);
      sorted.forEach((t, i) => {
        if (!teamPosRank[t.name]) teamPosRank[t.name] = {};
        teamPosRank[t.name][pos] = i + 1;
      });
    });

    // Overall score = sum of all position avgs
    return TEAMS.map(t => {
      const total = posIds.reduce((sum, pos) => sum + teamPosAvg[t.team_name][pos], 0);
      return {
        team_name: t.team_name,
        team_id: t.team_id,
        posAvgs: teamPosAvg[t.team_name],
        posRanks: teamPosRank[t.team_name],
        total,
      };
    }).sort((a, b) => b.total - a.total).map((t, i) => ({ ...t, overallRank: i + 1 }));
  }, [allData, validRounds]);

  // On-field slot count for active position
  const onFieldSlots = POSITIONS.find(p => p.id === activePos)?.slots || 1;

  // === Single position data ===
  const positionData = useMemo((): TeamLineStat[] => {
    if (activePos === 'ALL' || validRounds.length === 0) return [];

    // Get all rows for this position slot (scoring = on-field line total)
    const scoringData = allData.filter(r => r.pos === activePos && r.is_scoring && validRounds.includes(r.round_number));
    // Also get EMG and BN players in this pos slot
    const allPosData = allData.filter(r => r.pos === activePos && validRounds.includes(r.round_number));
    // EMG players: is_emg=true for this pos
    const emgData = allData.filter(r => r.pos === activePos && r.is_emg && validRounds.includes(r.round_number));
    // Bench players for this pos: not scoring, not emg, pos matches or BN
    const benchData = allData.filter(r => r.pos === 'BN' && validRounds.includes(r.round_number));

    // Latest round for determining current roles
    const latestRound = validRounds[validRounds.length - 1];

    const teamStats: TeamLineStat[] = TEAMS.map(team => {
      // Line totals per round (on-field only)
      const roundScores = validRounds.map(round => {
        const players = scoringData.filter(r => r.team_id === team.team_id && r.round_number === round && r.points != null);
        return { round, score: Math.round(players.reduce((sum, p) => sum + Number(p.points), 0)), rank: 0 };
      });

      const validScores = roundScores.map(r => r.score).filter(s => s > 0);
      const avg = validScores.length > 0 ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : 0;

      // === Player breakdown with roles ===
      // Determine each player's role from the latest round
      const latestOnField = new Set(
        scoringData.filter(r => r.team_id === team.team_id && r.round_number === latestRound).map(r => r.player_id)
      );
      const latestEmg = new Set(
        emgData.filter(r => r.team_id === team.team_id && r.round_number === latestRound).map(r => r.player_id)
      );

      // Build player stats from all their scoring appearances in this pos
      const playerMap: Record<number, { name: string; scores: number[]; player_id: number }> = {};
      // Include scoring appearances
      scoringData.filter(r => r.team_id === team.team_id && r.points != null).forEach(r => {
        if (!playerMap[r.player_id]) playerMap[r.player_id] = { name: r.player_name, scores: [], player_id: r.player_id };
        playerMap[r.player_id].scores.push(Number(r.points));
      });
      // Include EMG appearances (they may have scored too)
      emgData.filter(r => r.team_id === team.team_id && r.points != null && Number(r.points) > 0).forEach(r => {
        if (!playerMap[r.player_id]) playerMap[r.player_id] = { name: r.player_name, scores: [], player_id: r.player_id };
        if (!playerMap[r.player_id].scores.includes(Number(r.points))) {
          // Don't double-count if already counted via scoring
        }
      });
      // Include bench players who play this position (from bench data — need to match by checking if they've ever played this pos slot)
      const teamBenchLatest = benchData.filter(r => r.team_id === team.team_id && r.round_number === latestRound);
      // Also check allData for bench players who have played this pos slot in other rounds
      const teamAllRounds = allData.filter(r => r.team_id === team.team_id && validRounds.includes(r.round_number));
      const benchPlayersInPos = new Set<number>();
      teamAllRounds.forEach(r => {
        if (r.pos === activePos && !latestOnField.has(r.player_id) && !latestEmg.has(r.player_id)) {
          benchPlayersInPos.add(r.player_id);
        }
      });
      // Add EMG player stats if not already tracked
      emgData.filter(r => r.team_id === team.team_id && r.points != null).forEach(r => {
        if (!playerMap[r.player_id]) {
          playerMap[r.player_id] = { name: r.player_name, scores: [Number(r.points)], player_id: r.player_id };
        }
      });

      const allPlayers: PlayerBreakdown[] = Object.values(playerMap)
        .filter(p => p.scores.length > 0)
        .map(p => {
          let role: 'onfield' | 'emg' | 'bench' = 'bench';
          if (latestOnField.has(p.player_id)) role = 'onfield';
          else if (latestEmg.has(p.player_id)) role = 'emg';
          return {
            name: p.name, player_id: p.player_id,
            avg: Math.round(p.scores.reduce((a, b) => a + b, 0) / p.scores.length),
            gp: p.scores.length, role,
          };
        })
        .sort((a, b) => {
          // Sort by role (onfield first, then emg, then bench), then by avg desc
          const roleOrder = { onfield: 0, emg: 1, bench: 2 };
          if (roleOrder[a.role] !== roleOrder[b.role]) return roleOrder[a.role] - roleOrder[b.role];
          return b.avg - a.avg;
        });

      const onField = allPlayers.filter(p => p.role === 'onfield').sort((a, b) => b.avg - a.avg);
      const emg = allPlayers.filter(p => p.role === 'emg');
      const bench = allPlayers.filter(p => p.role === 'bench').sort((a, b) => b.avg - a.avg);

      return {
        team_name: team.team_name, team_id: team.team_id,
        avg, total: validScores.reduce((a, b) => a + b, 0),
        high: validScores.length > 0 ? Math.max(...validScores) : 0,
        low: validScores.length > 0 ? Math.min(...validScores) : 0,
        deltaFromLeagueAvg: 0, roundScores,
        players: allPlayers, onField, emg, bench,
      };
    });

    // Compute rankings per round
    validRounds.forEach((round, ri) => {
      const sorted = [...teamStats].sort((a, b) => (b.roundScores[ri]?.score || 0) - (a.roundScores[ri]?.score || 0));
      sorted.forEach((t, rank) => {
        const ts = teamStats.find(s => s.team_id === t.team_id);
        if (ts) ts.roundScores[ri].rank = rank + 1;
      });
    });

    // League average and delta
    const leagueAvg = teamStats.reduce((sum, t) => sum + t.avg, 0) / teamStats.length;
    teamStats.forEach(t => { t.deltaFromLeagueAvg = Math.round(t.avg - leagueAvg); });

    return teamStats.sort((a, b) => b.avg - a.avg);
  }, [allData, activePos, validRounds]);

  // Chart data for position
  const chartData = useMemo(() => {
    if (activePos === 'ALL' || positionData.length === 0) return [];
    return validRounds.map((round, i) => {
      const row: Record<string, unknown> = { round: `R${round}` };
      let sum = 0, count = 0;
      positionData.forEach(t => {
        const score = t.roundScores[i]?.score || 0;
        row[t.team_name] = score;
        if (score > 0) { sum += score; count++; }
      });
      row.leagueAvg = count > 0 ? Math.round(sum / count) : 0;
      return row;
    });
  }, [positionData, validRounds, activePos]);

  const chartYDomain = useMemo((): [number, number] => {
    const scores = chartData.flatMap(row => TEAMS.map(t => Number(row[t.team_name]) || 0)).filter(s => s > 0);
    if (scores.length === 0) return [0, 1000];
    const min = Math.min(...scores), max = Math.max(...scores);
    const pad = Math.round((max - min) * 0.2);
    return [Math.max(0, Math.floor((min - pad) / 25) * 25), Math.ceil((max + pad) / 25) * 25];
  }, [chartData]);

  const leagueAvgForPos = positionData.length > 0 ? Math.round(positionData.reduce((s, t) => s + t.avg, 0) / positionData.length) : 0;

  if (loading) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Loading line rankings...</p></div>;
  if (allData.length === 0) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Upload round data to see line rankings.</p></div>;

  return (
    <div className="space-y-6">
      {/* Position Sub-tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        <button
          onClick={() => { setActivePos('ALL'); setHighlightTeam(null); }}
          className={cn('px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
            activePos === 'ALL' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          All Lines
        </button>
        {POSITIONS.map(pos => (
          <button
            key={pos.id}
            onClick={() => { setActivePos(pos.id); setHighlightTeam(null); }}
            className={cn('px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
              activePos === pos.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {pos.label}
          </button>
        ))}
      </div>

      {/* === ALL LINES VIEW === */}
      {activePos === 'ALL' && crossPosSummary.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Cross-Position Line Rankings</h3>
            <p className="text-xs text-muted-foreground mt-1">Season average per position group, ranked 1-10</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-4 py-2.5 font-medium text-muted-foreground w-10">#</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Team</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">DEF</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">MID</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">RUC</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">FWD</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">UTL</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Total Avg</th>
                </tr>
              </thead>
              <tbody>
                {crossPosSummary.map((team, i) => (
                  <tr key={team.team_id} className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}>
                    <td className="px-4 py-3"><RankBadge rank={team.overallRank} size="md" /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TEAM_COLOR_MAP[team.team_id] }} />
                        <span className="font-medium">{team.team_name}</span>
                      </div>
                    </td>
                    {(['DEF', 'MID', 'RUC', 'FWD', 'UTL'] as const).map(pos => (
                      <td key={pos} className="px-3 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <RankBadge rank={team.posRanks[pos]} />
                          <span className="text-xs text-muted-foreground">{team.posAvgs[pos]}</span>
                        </div>
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-bold">{formatScore(team.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === SINGLE POSITION VIEW === */}
      {activePos !== 'ALL' && positionData.length > 0 && (
        <>
          {/* Season Average Table */}
          <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold">{POSITIONS.find(p => p.id === activePos)?.label} — Season Rankings</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-2.5 font-medium text-muted-foreground w-10">#</th>
                    <th className="px-3 py-2.5 font-medium text-muted-foreground">Team</th>
                    <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Avg/Rd</th>
                    <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Δ Avg</th>
                    <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Total</th>
                    <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">High</th>
                    <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Low</th>
                    {validRounds.map(r => (
                      <th key={r} className="px-2 py-2.5 font-medium text-muted-foreground text-center min-w-[56px]">R{r}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positionData.map((team, i) => (
                    <tr key={team.team_id} className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}>
                      <td className="px-3 py-2.5"><RankBadge rank={i + 1} size="md" /></td>
                      <td className="px-3 py-2.5 font-medium text-sm">{team.team_name}</td>
                      <td className={cn('px-3 py-2.5 text-right font-bold', avgBg(team.avg, leagueAvgForPos))}>
                        {team.avg}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={cn('text-xs font-semibold', team.deltaFromLeagueAvg > 0 ? 'text-green-600' : team.deltaFromLeagueAvg < 0 ? 'text-red-600' : 'text-muted-foreground')}>
                          {team.deltaFromLeagueAvg > 0 ? '+' : ''}{team.deltaFromLeagueAvg}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{formatScore(team.total)}</td>
                      <td className="px-3 py-2.5 text-right text-green-600 font-medium">{team.high}</td>
                      <td className="px-3 py-2.5 text-right text-red-600">{team.low}</td>
                      {team.roundScores.map((rs, ri) => (
                        <td key={ri} className="px-2 py-2.5 text-center">
                          <div className="text-xs font-medium">{rs.score || '—'}</div>
                          {rs.score > 0 && <RankBadge rank={rs.rank} />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Weekly Trend Chart */}
          {chartData.length > 1 && (
            <div className="bg-card border border-border rounded-lg shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">{POSITIONS.find(p => p.id === activePos)?.label} — Weekly Totals</h3>
                <p className="text-xs text-muted-foreground">Click team to isolate</p>
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="round" tick={{ fontSize: 12 }} />
                  <YAxis domain={chartYDomain} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '12px' }}
                    itemSorter={item => -(Number(item.value) || 0)}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', cursor: 'pointer' }} onClick={(d) => setHighlightTeam(prev => prev === d.value ? null : (d.value || null))} />
                  <Line type="monotone" dataKey="leagueAvg" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="6 4" dot={false} name="League Avg" legendType="plainline" />
                  {TEAMS.map(t => {
                    const isHl = !highlightTeam || highlightTeam === t.team_name;
                    return (
                      <Line key={t.team_name} type="monotone" dataKey={t.team_name} stroke={TEAM_COLOR_MAP[t.team_id]}
                        strokeWidth={highlightTeam === t.team_name ? 3.5 : 2} strokeOpacity={isHl ? 1 : 0.15}
                        dot={{ r: isHl ? 4 : 2, fillOpacity: isHl ? 1 : 0.15 }} activeDot={{ r: 6 }} />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Team Average Horizontal Bars */}
          <div className="bg-card border border-border rounded-lg shadow-sm p-5">
            <h3 className="font-semibold mb-4">{POSITIONS.find(p => p.id === activePos)?.label} — Team Average</h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={positionData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="team_name" type="category" width={170} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '12px' }} />
                <ReferenceLine x={leagueAvgForPos} stroke="#9CA3AF" strokeDasharray="5 5" label={{ value: 'Avg', position: 'top', fontSize: 10, fill: '#9CA3AF' }} />
                <Bar dataKey="avg" name="Avg Score" radius={[0, 4, 4, 0]}
                  label={{ position: 'right', fontSize: 11, fill: '#374151' }}>
                  {positionData.map((_, i) => (
                    <Cell key={i} fill={i < 3 ? '#16A34A' : i >= 7 ? '#DC2626' : '#1A56DB'} fillOpacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Line Composition Analysis */}
          <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold">{POSITIONS.find(p => p.id === activePos)?.label} — Line Composition</h3>
              <p className="text-xs text-muted-foreground mt-1">On-field vs emergency vs bench players, sorted by line ranking</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
              {positionData.map((team, i) => {
                const onFieldSlots = POSITIONS.find(p => p.id === activePos)?.slots || 1;
                const posLabel = POSITIONS.find(p => p.id === activePos)?.label || activePos;

                // Smart insight generation
                let insight = '';
                if (team.onField.length > 0) {
                  const bestOnField = team.onField[0];
                  const worstOnField = team.onField[team.onField.length - 1];
                  const onFieldAvg = Math.round(team.onField.reduce((s, p) => s + p.avg, 0) / team.onField.length);
                  const bestBench = team.bench[0];

                  if (activePos === 'RUC') {
                    // Ruck special case: single player
                    if (bestOnField.avg >= leagueAvgForPos + 10) {
                      insight = `${bestOnField.name} (${bestOnField.avg} avg) is a premium ruck — ${Math.round(bestOnField.avg - leagueAvgForPos)} pts above league average.`;
                    } else if (bestOnField.avg < leagueAvgForPos - 10) {
                      insight = `${bestOnField.name} averaging ${bestOnField.avg} — ${Math.abs(Math.round(bestOnField.avg - leagueAvgForPos))} pts below league average. Ruck upgrade needed.`;
                    } else {
                      insight = `${bestOnField.name} (${bestOnField.avg} avg) is a solid ruck option, tracking close to the league average.`;
                    }
                    if (team.emg.length > 0) {
                      insight += ` ${team.emg[0].name} (${team.emg[0].avg}) on standby.`;
                    }
                  } else if (i < 3 && worstOnField.avg >= onFieldAvg - 15) {
                    insight = `Top-3 line with balanced depth — weakest on-field starter ${worstOnField.name} still averaging ${worstOnField.avg}.`;
                  } else if (i < 3) {
                    insight = `Elite top end led by ${bestOnField.name} (${bestOnField.avg}), but ${worstOnField.name} (${worstOnField.avg}) drags the floor down.`;
                  } else if (i >= 7 && bestOnField.avg > 90) {
                    insight = `${bestOnField.name} (${bestOnField.avg}) is carrying this line almost single-handedly.`;
                  } else if (i >= 7) {
                    insight = `Bottom-3 ${posLabel.toLowerCase()} — no on-field player averaging above ${bestOnField.avg}.`;
                  } else if (bestBench && bestBench.avg > worstOnField.avg + 10) {
                    insight = `${bestBench.name} (${bestBench.avg} avg on bench) outscoring on-field ${worstOnField.name} (${worstOnField.avg}) — potential lineup mistake?`;
                  } else if (bestOnField.avg - worstOnField.avg > 40) {
                    insight = `Top-heavy: ${bestOnField.name} (${bestOnField.avg}) is ${bestOnField.avg - worstOnField.avg} pts above ${worstOnField.name} (${worstOnField.avg}).`;
                  } else {
                    insight = `Mid-table line averaging ${onFieldAvg}/rd across ${team.onField.length} starters — ${onFieldAvg > leagueAvgForPos ? 'above' : 'below'} the ${leagueAvgForPos} league average.`;
                  }
                }

                return (
                  <div key={team.team_id} className={cn('p-4 border-b border-r border-border', i % 2 === 0 && 'md:border-r')}>
                    <div className="flex items-center gap-2 mb-3">
                      <RankBadge rank={i + 1} size="md" />
                      <span className="font-semibold text-sm">{team.team_name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">Avg: {team.avg}/rd</span>
                    </div>

                    {/* ON FIELD */}
                    <div className="mb-2">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                        On Field ({team.onField.length}/{onFieldSlots})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {team.onField.map((p) => (
                          <span key={p.player_id} className={cn('text-xs px-1.5 py-0.5 rounded border font-medium',
                            p.avg >= 100 ? 'bg-green-50 text-green-700 border-green-200' :
                            p.avg >= 70 ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                            'bg-red-50 text-red-700 border-red-200'
                          )}>
                            {p.name.split(' ').pop()} {p.avg}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* EMG */}
                    {team.emg.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                          EMG
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {team.emg.map((p) => (
                            <span key={p.player_id} className="text-xs px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-600 opacity-75">
                              {p.name.split(' ').pop()} {p.avg}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* BENCH */}
                    {team.bench.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                          Bench
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {team.bench.map((p) => (
                            <span key={p.player_id} className="text-xs px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-400">
                              {p.name.split(' ').pop()} {p.avg}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground italic mt-1">{insight}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
