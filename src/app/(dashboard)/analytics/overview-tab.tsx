'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { formatScore } from '@/lib/utils';
import type { TeamSnapshot, PwrnkgsRanking } from '@/lib/types';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';

const TEAM_COLORS = [
  '#1A56DB', '#DC2626', '#16A34A', '#9333EA', '#EA580C',
  '#0891B2', '#CA8A04', '#DB2777', '#4F46E5', '#059669',
];

interface StandingsRow {
  team_name: string;
  team_id: number;
  coach: string;
  wins: number;
  losses: number;
  ties: number;
  pts_for: number;
  pts_against: number;
  pct: number;
  league_rank: number;
  pwrnkg: number | null;
}

export default function OverviewTab() {
  const [standings, setStandings] = useState<StandingsRow[]>([]);
  const [scoringTrends, setScoringTrends] = useState<Record<string, unknown>[]>([]);
  const [leagueAvg, setLeagueAvg] = useState<{ round: number; avg: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Get all team snapshots
      const { data: snapshots } = await supabase
        .from('team_snapshots')
        .select('*')
        .order('round_number', { ascending: true });

      // Get latest PWRNKGs rankings
      const { data: latestRound } = await supabase
        .from('pwrnkgs_rounds')
        .select('round_number')
        .eq('status', 'published')
        .order('round_number', { ascending: false })
        .limit(1)
        .single();

      let pwrnkgsMap: Record<number, number> = {};
      if (latestRound) {
        const { data: rankings } = await supabase
          .from('pwrnkgs_rankings')
          .select('team_id, ranking')
          .eq('round_number', latestRound.round_number);
        rankings?.forEach((r: { team_id: number; ranking: number }) => {
          pwrnkgsMap[r.team_id] = r.ranking;
        });
      }

      if (!snapshots || snapshots.length === 0) {
        setLoading(false);
        return;
      }

      // Get the latest round for standings
      const maxRound = Math.max(...snapshots.map((s: TeamSnapshot) => s.round_number));
      const latestSnapshots = snapshots.filter((s: TeamSnapshot) => s.round_number === maxRound);

      // Build standings
      const standingsData: StandingsRow[] = latestSnapshots
        .map((s: TeamSnapshot) => {
          const team = TEAMS.find((t) => t.team_id === s.team_id);
          return {
            team_name: s.team_name,
            team_id: s.team_id,
            coach: team?.coach || '',
            wins: s.wins,
            losses: s.losses,
            ties: s.ties,
            pts_for: Number(s.pts_for),
            pts_against: Number(s.pts_against),
            pct: Number(s.pct),
            league_rank: s.league_rank,
            pwrnkg: pwrnkgsMap[s.team_id] || null,
          };
        })
        .sort((a, b) => a.league_rank - b.league_rank);

      setStandings(standingsData);

      // Build scoring trends (pts_for per round per team)
      const rounds = [...new Set(snapshots.map((s: TeamSnapshot) => s.round_number))].sort((a, b) => a - b);
      const trendData = rounds.map((round) => {
        const row: Record<string, unknown> = { round: `R${round}` };
        const roundSnaps = snapshots.filter((s: TeamSnapshot) => s.round_number === round);
        // Calculate per-round score (difference from previous round's cumulative)
        roundSnaps.forEach((s: TeamSnapshot) => {
          const prevRound = snapshots.find(
            (p: TeamSnapshot) => p.team_id === s.team_id && p.round_number === round - 1
          );
          const roundScore = prevRound
            ? Number(s.pts_for) - Number(prevRound.pts_for)
            : Number(s.pts_for);
          row[s.team_name] = Math.round(roundScore);
        });
        return row;
      });
      setScoringTrends(trendData);

      // League average per round
      const avgData = rounds.map((round) => {
        const roundSnaps = snapshots.filter((s: TeamSnapshot) => s.round_number === round);
        const scores = roundSnaps.map((s: TeamSnapshot) => {
          const prevRound = snapshots.find(
            (p: TeamSnapshot) => p.team_id === s.team_id && p.round_number === round - 1
          );
          return prevRound ? Number(s.pts_for) - Number(prevRound.pts_for) : Number(s.pts_for);
        });
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        return { round, avg: Math.round(avg) };
      });
      setLeagueAvg(avgData);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
        <p className="text-muted-foreground">Loading analytics...</p>
      </div>
    );
  }

  if (standings.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
        <p className="text-muted-foreground">Upload round data to see league analytics.</p>
      </div>
    );
  }

  const teamNames = TEAMS.map((t) => t.team_name);

  return (
    <div className="space-y-6">
      {/* League Standings */}
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">League Standings</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium text-muted-foreground w-10">#</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Team</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-center">W</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-center">L</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-center">T</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">PF</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">PA</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">%</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-center">PWRNKG</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((team, i) => (
                <tr
                  key={team.team_id}
                  className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}
                >
                  <td className="px-4 py-2.5 font-semibold text-muted-foreground">{team.league_rank}</td>
                  <td className="px-4 py-2.5">
                    <div>
                      <span className="font-medium">{team.team_name}</span>
                      <span className="text-muted-foreground text-xs ml-2">{team.coach}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center font-medium text-green-600">{team.wins}</td>
                  <td className="px-4 py-2.5 text-center font-medium text-red-600">{team.losses}</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground">{team.ties}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatScore(team.pts_for)}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{formatScore(team.pts_against)}</td>
                  <td className="px-4 py-2.5 text-right">{(team.pct * 100).toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-center">
                    {team.pwrnkg ? (
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-xs">
                        {team.pwrnkg}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Scoring Trends Chart */}
      {scoringTrends.length > 1 && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-4">Weekly Scoring Trends</h3>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={scoringTrends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="round" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              {teamNames.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={TEAM_COLORS[i % TEAM_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* League Average Bar Chart */}
      {leagueAvg.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-4">League Average Score by Round</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={leagueAvg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="round" tickFormatter={(v) => `R${v}`} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                labelFormatter={(v) => `Round ${v}`}
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                {leagueAvg.map((_, i) => (
                  <Cell key={i} fill="#1A56DB" fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* PWRNKGs vs League Rank */}
      {standings.some((s) => s.pwrnkg) && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-4">PWRNKGs vs League Position</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {standings
              .filter((s) => s.pwrnkg)
              .sort((a, b) => (a.pwrnkg || 99) - (b.pwrnkg || 99))
              .map((team) => {
                const diff = team.league_rank - (team.pwrnkg || 0);
                return (
                  <div key={team.team_id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">
                      {team.pwrnkg}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{team.team_name}</p>
                      <p className="text-xs text-muted-foreground">
                        League: {team.league_rank}{team.league_rank === 1 ? 'st' : team.league_rank === 2 ? 'nd' : team.league_rank === 3 ? 'rd' : 'th'}
                      </p>
                    </div>
                    {diff !== 0 && (
                      <span className={`text-xs font-medium ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {diff > 0 ? `+${diff} overranked` : `${diff} underranked`}
                      </span>
                    )}
                    {diff === 0 && (
                      <span className="text-xs text-muted-foreground">Exact match</span>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
