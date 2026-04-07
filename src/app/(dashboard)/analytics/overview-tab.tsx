'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { formatScore } from '@/lib/utils';
import type { TeamSnapshot } from '@/lib/types';
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
      // Source of truth: player_rounds from lineups CSV
      const { data: playerRounds } = await supabase
        .from('player_rounds')
        .select('round_number, team_id, team_name, points, is_scoring');

      // Get team snapshots for standings (W/L/T/PF/PA come from teams CSV)
      const { data: snapshots } = await supabase
        .from('team_snapshots')
        .select('*')
        .order('round_number', { ascending: true });

      // Get latest PWRNKGs rankings
      const { data: latestPwrnkg } = await supabase
        .from('pwrnkgs_rounds')
        .select('round_number')
        .eq('status', 'published')
        .order('round_number', { ascending: false })
        .limit(1)
        .single();

      let pwrnkgsMap: Record<number, number> = {};
      if (latestPwrnkg) {
        const { data: rankings } = await supabase
          .from('pwrnkgs_rankings')
          .select('team_id, ranking')
          .eq('round_number', latestPwrnkg.round_number);
        rankings?.forEach((r: { team_id: number; ranking: number }) => {
          pwrnkgsMap[r.team_id] = r.ranking;
        });
      }

      // === Compute weekly scores from player_rounds (source of truth) ===
      // Sum points where is_scoring=true, grouped by round+team
      const teamRoundScores: Record<string, number> = {}; // "round-teamId" -> total
      const roundsSet = new Set<number>();

      playerRounds?.forEach((pr) => {
        if (!pr.is_scoring || pr.points == null) return;
        const key = `${pr.round_number}-${pr.team_id}`;
        teamRoundScores[key] = (teamRoundScores[key] || 0) + Number(pr.points);
        roundsSet.add(pr.round_number);
      });

      const rounds = [...roundsSet].sort((a, b) => a - b);

      // Build scoring trends
      const trendData = rounds.map((round) => {
        const row: Record<string, unknown> = { round: `R${round}` };
        TEAMS.forEach((team) => {
          const key = `${round}-${team.team_id}`;
          row[team.team_name] = Math.round(teamRoundScores[key] || 0);
        });
        return row;
      });
      setScoringTrends(trendData);

      // League average per round
      const avgData = rounds.map((round) => {
        const scores = TEAMS.map((team) => {
          const key = `${round}-${team.team_id}`;
          return teamRoundScores[key] || 0;
        });
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        return { round, avg: Math.round(avg) };
      });
      setLeagueAvg(avgData);

      // === Build standings from team_snapshots (latest round with W/L data) ===
      if (snapshots && snapshots.length > 0) {
        const maxRound = Math.max(...snapshots.map((s: TeamSnapshot) => s.round_number));
        const latestSnapshots = snapshots.filter((s: TeamSnapshot) => s.round_number === maxRound);

        // Compute cumulative PF from player_rounds for each team
        const cumulativePF: Record<number, number> = {};
        TEAMS.forEach((t) => {
          let total = 0;
          rounds.forEach((r) => {
            total += teamRoundScores[`${r}-${t.team_id}`] || 0;
          });
          cumulativePF[t.team_id] = total;
        });

        const standingsData: StandingsRow[] = latestSnapshots
          .map((s: TeamSnapshot) => {
            const team = TEAMS.find((t) => t.team_id === s.team_id);
            // Use pts_for from team_snapshots if available, otherwise from computed
            const ptsFor = Number(s.pts_for) > 0 ? Number(s.pts_for) : cumulativePF[s.team_id] || 0;
            return {
              team_name: s.team_name,
              team_id: s.team_id,
              coach: team?.coach || '',
              wins: s.wins,
              losses: s.losses,
              ties: s.ties,
              pts_for: ptsFor,
              pts_against: Number(s.pts_against),
              pct: Number(s.pct),
              league_rank: s.league_rank,
              pwrnkg: pwrnkgsMap[s.team_id] || null,
            };
          })
          .sort((a, b) => a.league_rank - b.league_rank);

        setStandings(standingsData);
      } else if (rounds.length > 0) {
        // No team snapshots yet but we have player data — show basic standings
        const standingsData: StandingsRow[] = TEAMS.map((team) => {
          let totalPF = 0;
          rounds.forEach((r) => {
            totalPF += teamRoundScores[`${r}-${team.team_id}`] || 0;
          });
          return {
            team_name: team.team_name,
            team_id: team.team_id,
            coach: team.coach,
            wins: 0, losses: 0, ties: 0,
            pts_for: totalPF,
            pts_against: 0,
            pct: 0,
            league_rank: 0,
            pwrnkg: pwrnkgsMap[team.team_id] || null,
          };
        }).sort((a, b) => b.pts_for - a.pts_for);

        // Assign ranks by PF
        standingsData.forEach((s, i) => { s.league_rank = i + 1; });
        setStandings(standingsData);
      }
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

  if (standings.length === 0 && scoringTrends.length === 0) {
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
      {standings.length > 0 && (
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
      )}

      {/* Scoring Trends Chart */}
      {scoringTrends.length > 0 && (
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
