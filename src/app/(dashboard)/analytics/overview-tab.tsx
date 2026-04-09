'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn, formatScore, ordinal } from '@/lib/utils';
import type { TeamSnapshot } from '@/lib/types';
import { fetchResolvedScores } from '@/lib/scores';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';
import InsightsPanel from '@/components/ai/insights-panel';

// Consistent team colors used across all charts in the portal
const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#1A56DB', // Mansion Mambas - blue
  3194005: '#DC2626', // South Tel Aviv Dragons - red
  3194009: '#16A34A', // SEANO - green
  3194003: '#F59E0B', // LIPI - amber
  3194006: '#9333EA', // Melech Mitchito - purple
  3194010: '#0891B2', // Cripps Don't Lie - cyan
  3194008: '#EA580C', // TMHCR - orange
  3194001: '#DB2777', // Doge Bombers - pink
  3194004: '#4F46E5', // Gun M Down - indigo
  3194007: '#059669', // Warnered613 - emerald
};

function getTeamColor(teamId: number): string {
  return TEAM_COLOR_MAP[teamId] || '#6B7280';
}

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

interface TrendRow {
  round: string;
  roundNum: number;
  leagueAvg: number;
  [key: string]: unknown;
}

// Custom tooltip that shows rank for each team
function ScoringTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].filter(p => p.name !== 'leagueAvg').sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  return (
    <div className="bg-white border border-border rounded-lg shadow-lg p-3 text-xs max-h-80 overflow-y-auto">
      <p className="font-bold mb-2">{label}</p>
      {sorted.map((entry, i) => (
        <div key={entry.name} className="flex items-center gap-2 py-0.5">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="flex-1 truncate">{entry.name}</span>
          <span className="font-bold">{formatScore(Number(entry.value))}</span>
          <span className="text-muted-foreground">({ordinal(i + 1)})</span>
        </div>
      ))}
    </div>
  );
}

export default function OverviewTab() {
  const [standings, setStandings] = useState<StandingsRow[]>([]);
  const [scoringTrends, setScoringTrends] = useState<TrendRow[]>([]);
  const [leagueAvgData, setLeagueAvgData] = useState<{ round: number; avg: number }[]>([]);
  const [yDomain, setYDomain] = useState<[number, number]>([0, 2000]);
  const [insights, setInsights] = useState<string[]>([]);
  const [pwrnkgRound, setPwrnkgRound] = useState<number | null>(null);
  const [highlightTeam, setHighlightTeam] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [latestRound, setLatestRound] = useState<number>(0);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      // Use resolved scores (manual override > matchup CSV > lineup sum)
      const { teamRoundScores, validRounds } = await fetchResolvedScores();
      if (validRounds.length > 0) setLatestRound(validRounds[validRounds.length - 1]);

      const { data: snapshots } = await supabase
        .from('team_snapshots')
        .select('*')
        .order('round_number', { ascending: true });

      const { data: latestPwrnkg } = await supabase
        .from('pwrnkgs_rounds')
        .select('round_number')
        .eq('status', 'published')
        .order('round_number', { ascending: false })
        .limit(1)
        .single();

      let pwrnkgsMap: Record<number, number> = {};
      if (latestPwrnkg) {
        setPwrnkgRound(latestPwrnkg.round_number);
        const { data: rankings } = await supabase
          .from('pwrnkgs_rankings')
          .select('team_id, ranking')
          .eq('round_number', latestPwrnkg.round_number);
        rankings?.forEach((r: { team_id: number; ranking: number }) => {
          pwrnkgsMap[r.team_id] = r.ranking;
        });
      }

      // Build scoring trends
      const allScores: number[] = [];
      const trendData: TrendRow[] = validRounds.map((round) => {
        const row: TrendRow = { round: `R${round}`, roundNum: round, leagueAvg: 0 };
        let sum = 0;
        let count = 0;
        TEAMS.forEach((team) => {
          const score = Math.round(teamRoundScores[`${round}-${team.team_id}`] || 0);
          row[team.team_name] = score;
          if (score > 0) {
            allScores.push(score);
            sum += score;
            count++;
          }
        });
        row.leagueAvg = count > 0 ? Math.round(sum / count) : 0;
        return row;
      });
      setScoringTrends(trendData);

      // Zoomed Y axis
      if (allScores.length > 0) {
        const minScore = Math.min(...allScores);
        const maxScore = Math.max(...allScores);
        const padding = Math.round((maxScore - minScore) * 0.2);
        setYDomain([
          Math.max(0, Math.floor((minScore - padding) / 50) * 50),
          Math.ceil((maxScore + padding) / 50) * 50,
        ]);
      }

      // League average per round
      const avgData = validRounds.map((round) => {
        const scores = TEAMS.map((t) => teamRoundScores[`${round}-${t.team_id}`] || 0).filter((s) => s > 500);
        const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        return { round, avg };
      });
      setLeagueAvgData(avgData);

      // === Build standings ===
      const cumulativePF: Record<number, number> = {};
      TEAMS.forEach((t) => {
        cumulativePF[t.team_id] = validRounds.reduce((sum, r) => sum + (teamRoundScores[`${r}-${t.team_id}`] || 0), 0);
      });

      if (snapshots && snapshots.length > 0) {
        const maxRound = Math.max(...snapshots.map((s: TeamSnapshot) => s.round_number));
        const latestSnapshots = snapshots.filter((s: TeamSnapshot) => s.round_number === maxRound);

        const standingsData: StandingsRow[] = latestSnapshots
          .map((s: TeamSnapshot) => {
            const team = TEAMS.find((t) => t.team_id === s.team_id);
            const ptsFor = Number(s.pts_for) > 0 ? Number(s.pts_for) : cumulativePF[s.team_id] || 0;
            return {
              team_name: s.team_name, team_id: s.team_id, coach: team?.coach || '',
              wins: s.wins, losses: s.losses, ties: s.ties,
              pts_for: ptsFor, pts_against: Number(s.pts_against),
              pct: Number(s.pct), league_rank: s.league_rank,
              pwrnkg: pwrnkgsMap[s.team_id] || null,
            };
          })
          .sort((a, b) => a.league_rank - b.league_rank);
        setStandings(standingsData);

        // === Generate Insights ===
        generateInsights(standingsData, teamRoundScores, validRounds, pwrnkgsMap, cumulativePF);
      } else if (validRounds.length > 0) {
        const standingsData: StandingsRow[] = TEAMS.map((team) => ({
          team_name: team.team_name, team_id: team.team_id, coach: team.coach,
          wins: 0, losses: 0, ties: 0, pts_for: cumulativePF[team.team_id] || 0,
          pts_against: 0, pct: 0, league_rank: 0, pwrnkg: pwrnkgsMap[team.team_id] || null,
        })).sort((a, b) => b.pts_for - a.pts_for);
        standingsData.forEach((s, i) => { s.league_rank = i + 1; });
        setStandings(standingsData);
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const generateInsights = (
    standings: StandingsRow[],
    teamRoundScores: Record<string, number>,
    validRounds: number[],
    pwrnkgsMap: Record<number, number>,
    cumulativePF: Record<number, number>,
  ) => {
    const ins: string[] = [];

    // 1. Over/under-ranked in PWRNKGs
    standings.forEach((team) => {
      if (!team.pwrnkg) return;
      const diff = team.league_rank - team.pwrnkg;
      if (Math.abs(diff) >= 3) {
        if (diff > 0) {
          ins.push(`${team.team_name} is ranked ${ordinal(team.pwrnkg)} in PWRNKGs but ${ordinal(team.league_rank)} on the ladder — the most overranked team.`);
        } else {
          ins.push(`${team.team_name} is ranked ${ordinal(team.pwrnkg)} in PWRNKGs but ${ordinal(team.league_rank)} on the ladder — the most underranked team.`);
        }
      }
    });

    // 4. Tight races
    if (standings.length >= 4) {
      const top4PF = standings.slice(0, 4);
      const gap = Math.max(...top4PF.map(t => t.pts_for)) - Math.min(...top4PF.map(t => t.pts_for));
      if (gap < validRounds.length * 150) {
        ins.push(`The top 4 teams are separated by just ${formatScore(Math.round(gap))} total points over ${validRounds.length} rounds — about ${formatScore(Math.round(gap / validRounds.length))} per week.`);
      }
    }

    // 5. Biggest single-round performances
    if (validRounds.length > 0) {
      let bestRound = { team: '', score: 0, round: 0 };
      let worstRound = { team: '', score: Infinity, round: 0 };
      TEAMS.forEach((t) => {
        validRounds.forEach((r) => {
          const score = teamRoundScores[`${r}-${t.team_id}`] || 0;
          if (score > bestRound.score) bestRound = { team: t.team_name, score, round: r };
          if (score < worstRound.score && score > 0) worstRound = { team: t.team_name, score, round: r };
        });
      });
      if (bestRound.score > 0) {
        ins.push(`Highest single-round score: ${bestRound.team} put up ${formatScore(bestRound.score)} in R${bestRound.round}.`);
      }
      if (worstRound.score < Infinity) {
        ins.push(`Lowest single-round score: ${worstRound.team} managed only ${formatScore(worstRound.score)} in R${worstRound.round}.`);
      }
    }

    // 6. Winless or undefeated
    standings.forEach((team) => {
      const totalGames = team.wins + team.losses + team.ties;
      if (totalGames >= 3 && team.wins === 0) {
        ins.push(`${team.team_name} is still winless at 0-${team.losses}${team.ties > 0 ? `-${team.ties}` : ''} after ${totalGames} rounds.`);
      }
      if (totalGames >= 3 && team.losses === 0) {
        ins.push(`${team.team_name} is the only undefeated team at ${team.wins}-0${team.ties > 0 ? `-${team.ties}` : ''}.`);
      }
    });

    setInsights(ins.slice(0, 8));
  };

  const handleLegendClick = useCallback((data: { value?: string }) => {
    setHighlightTeam((prev) => prev === data.value ? null : (data.value || null));
  }, []);

  if (loading) {
    return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Loading analytics...</p></div>;
  }

  if (standings.length === 0 && scoringTrends.length === 0) {
    return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Upload round data to see league analytics.</p></div>;
  }

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
                  <th className="px-4 py-2.5 font-medium text-muted-foreground text-center">PWRNKG</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((team, i) => (
                  <tr key={team.team_id} className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-bold">
                        {team.league_rank}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getTeamColor(team.team_id) }} />
                        <div>
                          <span className="font-medium">{team.team_name}</span>
                          <span className="text-muted-foreground text-xs ml-2">{team.coach}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center font-semibold text-green-600">{team.wins}</td>
                    <td className="px-4 py-2.5 text-center font-semibold text-red-600">{team.losses}</td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">{team.ties}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{formatScore(team.pts_for)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{formatScore(team.pts_against)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {team.pwrnkg ? (
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-xs">{team.pwrnkg}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Weekly Scoring Trends — Interactive */}
      {scoringTrends.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-1">Weekly Scoring Trends</h3>
          <p className="text-xs text-muted-foreground mb-4">Click a team name to isolate. Hover for rankings.</p>
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={scoringTrends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="round" tick={{ fontSize: 12 }} />
              <YAxis domain={yDomain} tick={{ fontSize: 12 }} />
              <Tooltip content={<ScoringTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '11px', cursor: 'pointer' }}
                onClick={handleLegendClick}
              />
              <ReferenceLine y={0} stroke="transparent" />
              {/* League average dashed line */}
              <Line
                type="monotone"
                dataKey="leagueAvg"
                stroke="#9CA3AF"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                dot={false}
                name="League Avg"
                legendType="plainline"
              />
              {TEAMS.map((team) => {
                const color = getTeamColor(team.team_id);
                const isHighlighted = !highlightTeam || highlightTeam === team.team_name;
                return (
                  <Line
                    key={team.team_name}
                    type="monotone"
                    dataKey={team.team_name}
                    stroke={color}
                    strokeWidth={highlightTeam === team.team_name ? 3.5 : 2}
                    strokeOpacity={isHighlighted ? 1 : 0.15}
                    dot={{ r: isHighlighted ? 4 : 2, fillOpacity: isHighlighted ? 1 : 0.15 }}
                    activeDot={{ r: 6 }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* League Average Bar Chart */}
      {leagueAvgData.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-4">League Average Score by Round</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={leagueAvgData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="round" tickFormatter={(v) => `R${v}`} tick={{ fontSize: 12 }} />
              <YAxis
                domain={[
                  Math.max(0, Math.floor((Math.min(...leagueAvgData.map(d => d.avg)) - 80) / 50) * 50),
                  Math.ceil((Math.max(...leagueAvgData.map(d => d.avg)) + 80) / 50) * 50,
                ]}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                labelFormatter={(v) => `Round ${v}`}
                formatter={(value) => [formatScore(Number(value)), 'Avg Score']}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '12px' }}
              />
              <ReferenceLine
                y={Math.round(leagueAvgData.reduce((a, b) => a + b.avg, 0) / leagueAvgData.length)}
                stroke="#9CA3AF"
                strokeDasharray="5 5"
                label={{ value: 'Season Avg', position: 'right', fontSize: 10, fill: '#9CA3AF' }}
              />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: '#6B7280' }}>
                {leagueAvgData.map((_, i) => (
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
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">PWRNKGs vs League Position</h3>
            {pwrnkgRound !== null && (
              <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">Based on R{pwrnkgRound} PWRNKGs</span>
            )}
          </div>
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
                      <p className="text-xs text-muted-foreground">League: {ordinal(team.league_rank)}</p>
                    </div>
                    {diff !== 0 && (
                      <span className={`text-xs font-medium ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {diff > 0 ? `+${diff} overranked` : `${diff} underranked`}
                      </span>
                    )}
                    {diff === 0 && <span className="text-xs text-muted-foreground">Exact match</span>}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Key Insights */}
      {insights.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-3">Key Insights</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((insight, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-lg bg-muted/30">
                <span className="text-primary font-bold text-sm mt-0.5 shrink-0">{i + 1}.</span>
                <p className="text-sm text-foreground leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
          {latestRound > 0 && (
            <InsightsPanel
              roundNumber={latestRound}
              sectionKey="overview_standings"
              sectionName="League Standings & Scoring Trends"
              sectionData={{ standings, scoringTrends: scoringTrends.slice(-3) }}
            />
          )}
        </div>
      )}
    </div>
  );
}
