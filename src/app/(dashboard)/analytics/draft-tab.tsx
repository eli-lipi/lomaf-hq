'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { DraftPick } from '@/lib/types';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from 'recharts';

// Position-based expected averages — forwards/rucks are more scarce so lower scores = higher value
const POSITION_BENCHMARKS: Record<string, { elite: number; good: number; avg: number }> = {
  MID: { elite: 110, good: 95, avg: 80 },
  DEF: { elite: 100, good: 85, avg: 70 },
  FWD: { elite: 90, good: 75, avg: 60 },
  RUC: { elite: 95, good: 80, avg: 65 },
};

function getPositionGroup(pos: string | null): string {
  if (!pos) return 'MID'; // default
  const p = pos.toUpperCase();
  if (p.includes('DEF')) return 'DEF';
  if (p.includes('FWD')) return 'FWD';
  if (p.includes('RUC') || p.includes('RUCK')) return 'RUC';
  return 'MID';
}

interface DraftPickWithStats extends DraftPick {
  avg_score: number | null;
  total_score: number | null;
  rounds_played: number;
  rating: 'steal' | 'value' | 'fair' | 'bust' | 'unknown';
  posGroup: string;
  posAvgDiff: number | null; // how far above/below position average
}

export default function DraftTab() {
  const [picks, setPicks] = useState<DraftPickWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'board' | 'chart'>('board');

  useEffect(() => {
    loadDraftData();
  }, []);

  const loadDraftData = async () => {
    try {
      const { data: draftPicks } = await supabase
        .from('draft_picks')
        .select('*')
        .order('overall_pick', { ascending: true });

      if (!draftPicks || draftPicks.length === 0) {
        setLoading(false);
        return;
      }

      // Get all player_rounds to compute averages
      const { data: playerRounds } = await supabase
        .from('player_rounds')
        .select('player_id, points, is_scoring, pos, round_number');

      // Filter out incomplete rounds
      const roundTeamCounts: Record<number, Set<number>> = {};
      playerRounds?.forEach((pr) => {
        if (pr.is_scoring && pr.points != null && Number(pr.points) > 0) {
          if (!roundTeamCounts[pr.round_number]) roundTeamCounts[pr.round_number] = new Set();
          // We don't have team_id here, but we can approximate by checking if enough data exists
        }
      });

      const playerStats: Record<number, { totalPts: number; count: number }> = {};
      playerRounds?.forEach((pr) => {
        if (pr.points != null && pr.is_scoring) {
          if (!playerStats[pr.player_id]) playerStats[pr.player_id] = { totalPts: 0, count: 0 };
          playerStats[pr.player_id].totalPts += Number(pr.points);
          playerStats[pr.player_id].count++;
        }
      });

      // Compute position averages across all scoring players
      const positionAvgs: Record<string, { total: number; count: number }> = {};
      playerRounds?.forEach((pr) => {
        if (pr.points != null && pr.is_scoring && Number(pr.points) > 0) {
          const pg = getPositionGroup(pr.pos);
          if (!positionAvgs[pg]) positionAvgs[pg] = { total: 0, count: 0 };
          positionAvgs[pg].total += Number(pr.points);
          positionAvgs[pg].count++;
        }
      });

      const enriched: DraftPickWithStats[] = draftPicks.map((pick) => {
        const stats = playerStats[pick.player_id];
        const avg = stats && stats.count >= 2 ? Math.round(stats.totalPts / stats.count) : null;
        const total = stats ? Math.round(stats.totalPts) : null;
        const rounds = stats?.count || 0;
        const posGroup = getPositionGroup(pick.position);
        const benchmark = POSITION_BENCHMARKS[posGroup] || POSITION_BENCHMARKS.MID;

        // Position-relative difference
        const posAvgDiff = avg !== null ? avg - benchmark.avg : null;

        // Rating system:
        // - First 20 picks: no one is a "steal" (expected to be elite). Only bust/fair/value.
        // - Compare against position-specific benchmarks
        let rating: DraftPickWithStats['rating'] = 'unknown';
        if (avg !== null && rounds >= 2) {
          const isTopPick = pick.overall_pick <= 20;

          if (avg >= benchmark.elite) {
            rating = isTopPick ? 'fair' : 'steal'; // Elite from a top pick is just expected
          } else if (avg >= benchmark.good) {
            rating = isTopPick ? 'fair' : 'value';
          } else if (avg >= benchmark.avg) {
            rating = 'fair';
          } else {
            // Below position average
            const deficit = benchmark.avg - avg;
            if (deficit > 20) {
              rating = 'bust';
            } else if (isTopPick && deficit > 10) {
              rating = 'bust'; // Higher standards for top picks
            } else {
              rating = 'fair';
            }
          }

          // Top 10 picks have even higher standards
          if (pick.overall_pick <= 10 && avg < benchmark.good) {
            rating = avg < benchmark.avg ? 'bust' : 'fair';
          }
        }

        return { ...pick, avg_score: avg, total_score: total, rounds_played: rounds, rating, posGroup, posAvgDiff };
      });

      setPicks(enriched);
    } catch (err) {
      console.error('Failed to load draft data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
        <p className="text-muted-foreground">Loading draft data...</p>
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
        <p className="text-muted-foreground">Upload draft data to see draft vs reality analysis.</p>
      </div>
    );
  }

  const maxRound = Math.max(...picks.map((p) => p.round));
  const draftRounds = Array.from({ length: maxRound }, (_, i) => i + 1);
  const teamOrder = TEAMS.map((t) => t.team_id);

  const ratingColors: Record<string, string> = {
    steal: 'bg-green-100 text-green-700 border-green-300',
    value: 'bg-blue-100 text-blue-700 border-blue-300',
    fair: 'bg-gray-100 text-gray-600 border-gray-300',
    bust: 'bg-red-100 text-red-700 border-red-300',
    unknown: 'bg-gray-50 text-gray-400 border-gray-200',
  };

  const ratingDotColors: Record<string, string> = {
    steal: '#16A34A',
    value: '#2563EB',
    fair: '#6B7280',
    bust: '#DC2626',
    unknown: '#D1D5DB',
  };

  const posGroupColors: Record<string, string> = {
    DEF: 'text-blue-600',
    MID: 'text-green-600',
    FWD: 'text-red-600',
    RUC: 'text-purple-600',
  };

  // Scatter data: position-adjusted value
  const scatterData = picks
    .filter((p) => p.avg_score !== null)
    .map((p) => ({
      pick: p.overall_pick,
      avg: p.avg_score,
      name: p.player_name,
      team: p.team_name,
      rating: p.rating,
      pos: p.posGroup,
      posAvgDiff: p.posAvgDiff,
    }));

  return (
    <div className="space-y-6">
      {/* View toggle + Legend */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setViewMode('board')}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
            viewMode === 'board' ? 'bg-primary text-primary-foreground' : 'bg-card border border-border hover:bg-muted/50'
          )}
        >
          Draft Board
        </button>
        <button
          onClick={() => setViewMode('chart')}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
            viewMode === 'chart' ? 'bg-primary text-primary-foreground' : 'bg-card border border-border hover:bg-muted/50'
          )}
        >
          Position Value Chart
        </button>
        <div className="flex flex-wrap gap-3 text-xs ml-auto">
          {['steal', 'value', 'fair', 'bust'].map((r) => (
            <div key={r} className="flex items-center gap-1.5">
              <div className={cn('w-3 h-3 rounded-sm border', ratingColors[r])} />
              <span className="capitalize text-muted-foreground">{r}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Position benchmarks info */}
      <div className="bg-muted/30 rounded-lg p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Position-Adjusted Ratings</p>
        <p>
          Ratings account for positional scarcity: a FWD averaging 90 is elite, while a MID needs 110+.
          Top-20 picks are held to higher standards — elite output is expected, not a steal.
        </p>
        <div className="flex flex-wrap gap-4 mt-2">
          {Object.entries(POSITION_BENCHMARKS).map(([pos, b]) => (
            <span key={pos}>
              <strong className={posGroupColors[pos]}>{pos}:</strong> Elite {b.elite}+ · Good {b.good}+ · Avg {b.avg}+
            </span>
          ))}
        </div>
      </div>

      {viewMode === 'board' ? (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground sticky left-0 bg-muted/50 z-10 w-14">Rd</th>
                  {TEAMS.map((t) => (
                    <th key={t.team_id} className="px-2 py-2.5 text-center font-medium text-muted-foreground min-w-[120px]">
                      <span className="truncate block">{t.team_name.length > 14 ? t.team_name.slice(0, 12) + '...' : t.team_name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draftRounds.map((round) => (
                  <tr key={round} className={round % 2 === 0 ? 'bg-muted/10' : ''}>
                    <td className="px-3 py-2 font-semibold text-muted-foreground sticky left-0 bg-card z-10">{round}</td>
                    {teamOrder.map((teamId) => {
                      const pick = picks.find((p) => p.round === round && p.team_id === teamId);
                      if (!pick) return <td key={teamId} className="px-2 py-2 text-center text-muted-foreground">—</td>;
                      return (
                        <td key={teamId} className="px-2 py-2">
                          <div className={cn('rounded-md p-1.5 border text-center', ratingColors[pick.rating])}>
                            <p className="font-medium truncate">{pick.player_name}</p>
                            <p className="text-[10px] opacity-70">
                              {pick.avg_score !== null ? `Avg: ${pick.avg_score}` : 'No data'}
                              {pick.posGroup ? ` · ${pick.posGroup}` : ''}
                              {pick.posAvgDiff !== null ? ` (${pick.posAvgDiff > 0 ? '+' : ''}${pick.posAvgDiff})` : ''}
                            </p>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-1">Draft Pick vs Position-Adjusted Score</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Y-axis shows how far above/below position average each player scores. Color = value rating.
          </p>
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="pick"
                name="Pick #"
                tick={{ fontSize: 12 }}
                label={{ value: 'Overall Pick', position: 'insideBottom', offset: -5, fontSize: 12 }}
              />
              <YAxis
                dataKey="posAvgDiff"
                name="vs Pos Avg"
                tick={{ fontSize: 12 }}
                label={{ value: 'vs Position Average', angle: -90, position: 'insideLeft', fontSize: 12 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-bold">{d.name}</p>
                      <p className="text-muted-foreground">{d.team}</p>
                      <p>Pick #{d.pick} · {d.pos} · Avg: {d.avg}</p>
                      <p>{d.posAvgDiff > 0 ? '+' : ''}{d.posAvgDiff} vs {d.pos} average</p>
                      <p className="capitalize font-medium" style={{ color: ratingDotColors[d.rating] }}>{d.rating}</p>
                    </div>
                  );
                }}
              />
              <Scatter data={scatterData.filter((s) => s.posAvgDiff !== null)}>
                {scatterData.filter((s) => s.posAvgDiff !== null).map((entry, i) => (
                  <Cell key={i} fill={ratingDotColors[entry.rating]} fillOpacity={0.8} r={5} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top Steals & Biggest Busts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border bg-green-50">
            <h3 className="font-semibold text-green-700">Top Steals</h3>
            <p className="text-xs text-green-600 mt-0.5">Late picks outperforming position expectations</p>
          </div>
          <div className="divide-y divide-border">
            {picks
              .filter((p) => p.rating === 'steal')
              .sort((a, b) => (b.posAvgDiff || 0) - (a.posAvgDiff || 0))
              .slice(0, 8)
              .map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs font-mono text-muted-foreground w-8">#{p.overall_pick}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.player_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.team_name} · {p.posGroup}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-green-600">Avg {p.avg_score}</span>
                    <p className="text-[10px] text-green-500">+{p.posAvgDiff} vs pos avg</p>
                  </div>
                </div>
              ))}
            {picks.filter((p) => p.rating === 'steal').length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">No steals identified yet</p>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border bg-red-50">
            <h3 className="font-semibold text-red-700">Biggest Busts</h3>
            <p className="text-xs text-red-600 mt-0.5">Players significantly underperforming position expectations</p>
          </div>
          <div className="divide-y divide-border">
            {picks
              .filter((p) => p.rating === 'bust')
              .sort((a, b) => (a.posAvgDiff || 0) - (b.posAvgDiff || 0))
              .slice(0, 8)
              .map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs font-mono text-muted-foreground w-8">#{p.overall_pick}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.player_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.team_name} · {p.posGroup}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-red-600">Avg {p.avg_score}</span>
                    <p className="text-[10px] text-red-500">{p.posAvgDiff} vs pos avg</p>
                  </div>
                </div>
              ))}
            {picks.filter((p) => p.rating === 'bust').length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">No busts identified yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
