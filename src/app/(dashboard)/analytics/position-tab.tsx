'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell,
} from 'recharts';

const POSITIONS = [
  { id: 'DEF', label: 'Defence' },
  { id: 'MID', label: 'Midfield' },
  { id: 'RUC', label: 'Ruck' },
  { id: 'FWD', label: 'Forward' },
  { id: 'UTL', label: 'Flex' },
  { id: 'BENCH', label: 'Bench' },
] as const;

type PosId = (typeof POSITIONS)[number]['id'];

interface PlayerRoundRow {
  round_number: number;
  team_id: number;
  team_name: string;
  player_id: number;
  player_name: string;
  pos: string;
  is_scoring: boolean;
  is_emg: boolean;
  points: number | null;
}

interface PlayerStat {
  player_id: number;
  player_name: string;
  team_name: string;
  team_id: number;
  avg: number;
  total: number;
  high: number;
  low: number;
  gamesPlayed: number;
  scores: number[];
}

interface TeamPosStat {
  team_name: string;
  team_id: number;
  avg: number;
  total: number;
  high: number;
  low: number;
  roundScores: { round: number; score: number }[];
}

const TEAM_COLORS = [
  '#1A56DB', '#DC2626', '#16A34A', '#9333EA', '#EA580C',
  '#0891B2', '#CA8A04', '#DB2777', '#4F46E5', '#059669',
];

export default function PositionDeepDiveTab() {
  const [activePos, setActivePos] = useState<PosId>('DEF');
  const [allData, setAllData] = useState<PlayerRoundRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Fetch all player_rounds — this is the source of truth
      const allRows: PlayerRoundRow[] = [];
      let offset = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from('player_rounds')
          .select('round_number, team_id, team_name, player_id, player_name, pos, is_scoring, is_emg, points')
          .range(offset, offset + pageSize - 1)
          .order('round_number', { ascending: true });

        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < pageSize) break;
        offset += pageSize;
      }

      setAllData(allRows);
    } catch (err) {
      console.error('Failed to load position data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter out incomplete rounds (where most teams have no real scores)
  const validRounds = useMemo(() => {
    const rounds = [...new Set(allData.map((r) => r.round_number))].sort((a, b) => a - b);
    return rounds.filter((round) => {
      const roundData = allData.filter((r) => r.round_number === round && r.is_scoring && r.points != null && Number(r.points) > 0);
      const teamsWithData = new Set(roundData.map((r) => r.team_id));
      return teamsWithData.size >= 5;
    });
  }, [allData]);

  // Filter data for the active position
  const posData = useMemo(() => {
    if (activePos === 'BENCH') {
      return allData.filter((r) => !r.is_scoring && validRounds.includes(r.round_number));
    }
    return allData.filter((r) => r.pos === activePos && r.is_scoring && validRounds.includes(r.round_number));
  }, [allData, activePos, validRounds]);

  // === Player stats for this position ===
  const playerStats = useMemo((): PlayerStat[] => {
    const map: Record<string, { player_id: number; player_name: string; team_name: string; team_id: number; scores: number[] }> = {};

    posData.forEach((r) => {
      if (r.points == null) return;
      const key = `${r.player_id}-${r.team_id}`;
      if (!map[key]) {
        map[key] = { player_id: r.player_id, player_name: r.player_name, team_name: r.team_name, team_id: r.team_id, scores: [] };
      }
      map[key].scores.push(Number(r.points));
    });

    return Object.values(map)
      .filter((p) => p.scores.length > 0)
      .map((p) => ({
        ...p,
        avg: Math.round(p.scores.reduce((a, b) => a + b, 0) / p.scores.length),
        total: Math.round(p.scores.reduce((a, b) => a + b, 0)),
        high: Math.max(...p.scores),
        low: Math.min(...p.scores),
        gamesPlayed: p.scores.length,
      }));
  }, [posData]);

  // === Team-level stats for this position ===
  const teamStats = useMemo((): TeamPosStat[] => {
    return TEAMS.map((team) => {
      const roundScores = validRounds.map((round) => {
        const players = posData.filter((r) => r.team_id === team.team_id && r.round_number === round && r.points != null);
        const score = players.reduce((sum, p) => sum + Number(p.points), 0);
        return { round, score: Math.round(score) };
      });

      const scores = roundScores.map((r) => r.score).filter((s) => s > 0);
      return {
        team_name: team.team_name,
        team_id: team.team_id,
        avg: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        total: scores.reduce((a, b) => a + b, 0),
        high: scores.length > 0 ? Math.max(...scores) : 0,
        low: scores.length > 0 ? Math.min(...scores) : 0,
        roundScores,
      };
    }).sort((a, b) => b.avg - a.avg);
  }, [posData, validRounds]);

  // === Rankings by round (team level) ===
  const weeklyRankings = useMemo(() => {
    return validRounds.map((round) => {
      const teamScores = TEAMS.map((team) => {
        const players = posData.filter((r) => r.team_id === team.team_id && r.round_number === round && r.points != null);
        return { team_name: team.team_name, score: players.reduce((sum, p) => sum + Number(p.points), 0) };
      }).sort((a, b) => b.score - a.score);

      return { round, rankings: teamScores };
    });
  }, [posData, validRounds]);

  // Top/Bottom scorers
  const topScorers = useMemo(() => [...playerStats].sort((a, b) => b.avg - a.avg).slice(0, 15), [playerStats]);
  const topSingleScores = useMemo(() => {
    const all: { player_name: string; team_name: string; round: number; points: number }[] = [];
    posData.forEach((r) => {
      if (r.points != null) all.push({ player_name: r.player_name, team_name: r.team_name, round: r.round_number, points: Number(r.points) });
    });
    return all.sort((a, b) => b.points - a.points).slice(0, 10);
  }, [posData]);

  const bottomSingleScores = useMemo(() => {
    const all: { player_name: string; team_name: string; round: number; points: number }[] = [];
    posData.forEach((r) => {
      if (r.points != null) all.push({ player_name: r.player_name, team_name: r.team_name, round: r.round_number, points: Number(r.points) });
    });
    return all.sort((a, b) => a.points - b.points).slice(0, 10);
  }, [posData]);

  // Chart: team line totals by round
  const teamTrendData = useMemo(() => {
    return validRounds.map((round) => {
      const row: Record<string, unknown> = { round: `R${round}` };
      TEAMS.forEach((team) => {
        const stat = teamStats.find((ts) => ts.team_id === team.team_id);
        const rs = stat?.roundScores.find((r) => r.round === round);
        row[team.team_name] = rs?.score || 0;
      });
      return row;
    });
  }, [validRounds, teamStats]);

  // Y domain for team trend
  const trendYDomain = useMemo((): [number, number] => {
    const allScores = teamTrendData.flatMap((row) =>
      TEAMS.map((t) => Number(row[t.team_name]) || 0)
    ).filter((s) => s > 0);
    if (allScores.length === 0) return [0, 1000];
    const min = Math.min(...allScores);
    const max = Math.max(...allScores);
    const pad = Math.round((max - min) * 0.15);
    return [
      Math.max(0, Math.floor((min - pad) / 25) * 25),
      Math.ceil((max + pad) / 25) * 25,
    ];
  }, [teamTrendData]);

  if (loading) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
        <p className="text-muted-foreground">Loading position data...</p>
      </div>
    );
  }

  if (allData.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
        <p className="text-muted-foreground">Upload round data to see position analytics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Position Sub-tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {POSITIONS.map((pos) => (
          <button
            key={pos.id}
            onClick={() => setActivePos(pos.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
              activePos === pos.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {pos.label}
          </button>
        ))}
      </div>

      {/* Team Rankings Table */}
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">
            {POSITIONS.find((p) => p.id === activePos)?.label} — Team Rankings (Season Average)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium text-muted-foreground w-10">#</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Team</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Avg/Rd</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Total</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">High</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Low</th>
                {validRounds.map((r) => (
                  <th key={r} className="px-3 py-2.5 font-medium text-muted-foreground text-center">R{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamStats.map((team, i) => (
                <tr key={team.team_id} className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}>
                  <td className="px-4 py-2.5 font-semibold text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-sm">{team.team_name}</td>
                  <td className="px-4 py-2.5 text-right font-bold">{team.avg}</td>
                  <td className="px-4 py-2.5 text-right">{team.total}</td>
                  <td className="px-4 py-2.5 text-right text-green-600 font-medium">{team.high}</td>
                  <td className="px-4 py-2.5 text-right text-red-600">{team.low}</td>
                  {validRounds.map((round) => {
                    const rs = team.roundScores.find((r) => r.round === round);
                    // Rank this team for this round
                    const roundRanking = weeklyRankings.find((wr) => wr.round === round);
                    const rankIdx = roundRanking?.rankings.findIndex((r) => r.team_name === team.team_name) ?? -1;
                    const rank = rankIdx >= 0 ? rankIdx + 1 : null;
                    return (
                      <td key={round} className="px-3 py-2.5 text-center text-xs">
                        <div className="font-medium">{rs?.score || 0}</div>
                        {rank && (
                          <div className={cn(
                            'text-[10px]',
                            rank <= 3 ? 'text-green-600 font-semibold' : rank >= 8 ? 'text-red-500' : 'text-muted-foreground'
                          )}>
                            #{rank}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Team Line Trend Chart */}
      {teamTrendData.length > 1 && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-4">
            {POSITIONS.find((p) => p.id === activePos)?.label} — Weekly Team Totals
          </h3>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={teamTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="round" tick={{ fontSize: 12 }} />
              <YAxis domain={trendYDomain} tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '12px' }}
                itemSorter={(item) => -(Number(item.value) || 0)}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              {TEAMS.map((t, i) => (
                <Line key={t.team_name} type="monotone" dataKey={t.team_name} stroke={TEAM_COLORS[i]} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Player Rankings + Top/Bottom Scores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Players by Average */}
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">
              Top {activePos === 'BENCH' ? 'Bench' : activePos} Players — Season Average
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Player</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Team</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Avg</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">High</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Low</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">GP</th>
                </tr>
              </thead>
              <tbody>
                {topScorers.map((p, i) => (
                  <tr key={`${p.player_id}-${p.team_id}`} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                    <td className="px-3 py-2 font-semibold text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{p.player_name}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[100px]">{p.team_name}</td>
                    <td className="px-3 py-2 text-right font-bold">{p.avg}</td>
                    <td className="px-3 py-2 text-right">{p.total}</td>
                    <td className="px-3 py-2 text-right text-green-600">{p.high}</td>
                    <td className="px-3 py-2 text-right text-red-600">{p.low}</td>
                    <td className="px-3 py-2 text-center">{p.gamesPlayed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Single-Round Scores + Bottom Single-Round Scores */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border bg-green-50">
              <h3 className="font-semibold text-green-700">Top Single-Round Scores</h3>
            </div>
            <div className="divide-y divide-border">
              {topSingleScores.map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2">
                  <span className="text-xs font-mono text-muted-foreground w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.player_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.team_name} · R{s.round}</p>
                  </div>
                  <span className="text-sm font-bold text-green-600">{s.points}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border bg-red-50">
              <h3 className="font-semibold text-red-700">Lowest Single-Round Scores</h3>
            </div>
            <div className="divide-y divide-border">
              {bottomSingleScores.map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2">
                  <span className="text-xs font-mono text-muted-foreground w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.player_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.team_name} · R{s.round}</p>
                  </div>
                  <span className="text-sm font-bold text-red-600">{s.points}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Team Average Bar Chart */}
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        <h3 className="font-semibold mb-4">
          {POSITIONS.find((p) => p.id === activePos)?.label} — Team Average per Round
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={teamStats} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis
              dataKey="team_name"
              type="category"
              width={160}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '12px' }}
            />
            <Bar dataKey="avg" name="Avg Score" radius={[0, 4, 4, 0]}>
              {teamStats.map((_, i) => (
                <Cell key={i} fill={i < 3 ? '#16A34A' : i >= 7 ? '#DC2626' : '#1A56DB'} fillOpacity={0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
