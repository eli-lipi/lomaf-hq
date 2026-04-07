'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS, POSITION_GROUPS } from '@/lib/constants';
import { formatScore } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { TeamSnapshot, PlayerRound } from '@/lib/types';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, Cell,
} from 'recharts';

export default function TeamDeepDiveTab() {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [snapshots, setSnapshots] = useState<TeamSnapshot[]>([]);
  const [playerData, setPlayerData] = useState<PlayerRound[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedTeamId) loadTeamData(selectedTeamId);
  }, [selectedTeamId]);

  const loadTeamData = async (teamId: number) => {
    setLoading(true);
    try {
      const [{ data: snaps }, { data: players }] = await Promise.all([
        supabase
          .from('team_snapshots')
          .select('*')
          .eq('team_id', teamId)
          .order('round_number', { ascending: true }),
        supabase
          .from('player_rounds')
          .select('*')
          .eq('team_id', teamId)
          .order('round_number', { ascending: true }),
      ]);

      setSnapshots(snaps || []);
      setPlayerData(players || []);
    } catch (err) {
      console.error('Failed to load team data:', err);
    } finally {
      setLoading(false);
    }
  };

  const team = TEAMS.find((t) => t.team_id === selectedTeamId);
  const latestSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  // Compute weekly scores from player_rounds (source of truth)
  const roundsWithData = [...new Set(playerData.map((p) => p.round_number))].sort((a, b) => a - b);

  const scoreTrend = roundsWithData.map((round) => {
    const roundPlayers = playerData.filter((p) => p.round_number === round && p.is_scoring);
    const total = roundPlayers.reduce((sum, p) => sum + (Number(p.points) || 0), 0);
    return { round: `R${round}`, score: Math.round(total) };
  });

  // Cumulative PF from player_rounds
  const cumulativePF = roundsWithData.reduce((sum, round) => {
    const roundPlayers = playerData.filter((p) => p.round_number === round && p.is_scoring);
    return sum + roundPlayers.reduce((s, p) => s + (Number(p.points) || 0), 0);
  }, 0);

  // Average score per round
  const avgScore = roundsWithData.length > 0 ? Math.round(cumulativePF / roundsWithData.length) : 0;

  // Line ranking radar for latest round
  const radarData = latestSnap
    ? POSITION_GROUPS.map((pos) => ({
        position: pos,
        rank: 11 - (latestSnap[`${pos.toLowerCase()}_rank` as keyof TeamSnapshot] as number || 5),
        seasonRank: 11 - (latestSnap[`${pos.toLowerCase()}_season_rank` as keyof TeamSnapshot] as number || 5),
      }))
    : [];

  // Line totals by round - computed from player_rounds
  const lineTrends = roundsWithData.map((round) => {
    const roundPlayers = playerData.filter((p) => p.round_number === round && p.is_scoring);
    const byPos: Record<string, number> = { DEF: 0, MID: 0, FWD: 0, RUC: 0 };
    roundPlayers.forEach((p) => {
      const pos = p.pos.toUpperCase();
      if (pos in byPos) byPos[pos] += Number(p.points) || 0;
    });
    return {
      round: `R${round}`,
      DEF: Math.round(byPos.DEF),
      MID: Math.round(byPos.MID),
      FWD: Math.round(byPos.FWD),
      RUC: Math.round(byPos.RUC),
    };
  });

  // Top scorers for the team (latest round)
  const latestRound = roundsWithData.length > 0 ? roundsWithData[roundsWithData.length - 1] : 0;
  const latestPlayers = playerData
    .filter((p) => p.round_number === latestRound && p.is_scoring)
    .sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));

  // Bench points wasted (non-scoring players who scored)
  const benchByRound = roundsWithData.map((round) => {
    const roundPlayers = playerData.filter((p) => p.round_number === round);
    const benchPts = roundPlayers
      .filter((p) => !p.is_scoring && Number(p.points) > 0)
      .reduce((sum, p) => sum + (Number(p.points) || 0), 0);
    return { round: `R${round}`, benchPts: Math.round(benchPts) };
  });

  const hasData = roundsWithData.length > 0;

  return (
    <div className="space-y-6">
      {/* Team Selector */}
      <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
        <h3 className="font-semibold text-sm mb-3">Select Team</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {TEAMS.map((t) => (
            <button
              key={t.team_id}
              onClick={() => setSelectedTeamId(t.team_id)}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium transition-colors border text-left truncate',
                selectedTeamId === t.team_id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card border-border hover:bg-muted/50 text-foreground'
              )}
            >
              {t.team_name}
            </button>
          ))}
        </div>
      </div>

      {!selectedTeamId && (
        <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
          <p className="text-muted-foreground">Select a team above to see detailed analytics.</p>
        </div>
      )}

      {loading && (
        <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
          <p className="text-muted-foreground">Loading team data...</p>
        </div>
      )}

      {selectedTeamId && !loading && hasData && (
        <>
          {/* Team Header Stats */}
          <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
            <h3 className="font-semibold text-lg mb-1">{team?.team_name}</h3>
            <p className="text-muted-foreground text-sm mb-4">{team?.coach}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
              {latestSnap && (
                <StatCard label="Record" value={`${latestSnap.wins}-${latestSnap.losses}-${latestSnap.ties}`} />
              )}
              <StatCard label="Points For" value={formatScore(Math.round(cumulativePF))} />
              {latestSnap && Number(latestSnap.pts_against) > 0 && (
                <StatCard label="Points Against" value={formatScore(Number(latestSnap.pts_against))} />
              )}
              {latestSnap && latestSnap.league_rank > 0 && (
                <StatCard label="League Rank" value={`#${latestSnap.league_rank}`} />
              )}
              {latestSnap && Number(latestSnap.pct) > 0 && (
                <StatCard label="Win %" value={`${(Number(latestSnap.pct) * 100).toFixed(1)}%`} />
              )}
              <StatCard label="Avg Score" value={formatScore(avgScore)} />
            </div>
          </div>

          {/* Score Trend */}
          {scoreTrend.length > 1 && (
            <div className="bg-card border border-border rounded-lg shadow-sm p-5">
              <h3 className="font-semibold mb-4">Weekly Score Trend</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={scoreTrend}>
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
                  <Line type="monotone" dataKey="score" stroke="#1A56DB" strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Line Rankings Radar + Line Breakdown side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar Chart */}
            {radarData.length > 0 && (
              <div className="bg-card border border-border rounded-lg shadow-sm p-5">
                <h3 className="font-semibold mb-4">Line Rankings (Latest Round)</h3>
                <p className="text-xs text-muted-foreground mb-3">Higher = better rank (inverted for readability)</p>
                <ResponsiveContainer width="100%" height={280}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#E5E7EB" />
                    <PolarAngleAxis dataKey="position" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                    <Radar name="This Round" dataKey="rank" stroke="#1A56DB" fill="#1A56DB" fillOpacity={0.3} />
                    <Radar name="Season" dataKey="seasonRank" stroke="#16A34A" fill="#16A34A" fillOpacity={0.15} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Line Totals By Round */}
            {lineTrends.length > 0 && (
              <div className="bg-card border border-border rounded-lg shadow-sm p-5">
                <h3 className="font-semibold mb-4">Line Scores by Round</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={lineTrends}>
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
                    <Bar dataKey="DEF" fill="#1A56DB" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="MID" fill="#16A34A" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="FWD" fill="#DC2626" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="RUC" fill="#9333EA" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Top Scorers + Bench Points */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Scorers */}
            {latestPlayers.length > 0 && (
              <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
                <div className="p-4 border-b border-border">
                  <h3 className="font-semibold">Top Scorers — Round {latestRound}</h3>
                </div>
                <div className="divide-y divide-border">
                  {latestPlayers.slice(0, 10).map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-xs font-mono text-muted-foreground w-5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.player_name}</p>
                        <p className="text-xs text-muted-foreground">{p.pos}</p>
                      </div>
                      <span className="text-sm font-bold">{p.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bench Points Wasted */}
            {benchByRound.length > 0 && (
              <div className="bg-card border border-border rounded-lg shadow-sm p-5">
                <h3 className="font-semibold mb-4">Bench Points Wasted</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={benchByRound}>
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
                    <Bar dataKey="benchPts" name="Bench Points" radius={[4, 4, 0, 0]}>
                      {benchByRound.map((_, i) => (
                        <Cell key={i} fill="#EA580C" fillOpacity={0.7} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}

      {selectedTeamId && !loading && !hasData && (
        <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
          <p className="text-muted-foreground">No data available for this team yet. Upload round data first.</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
