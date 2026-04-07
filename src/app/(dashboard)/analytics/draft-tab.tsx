'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { formatScore } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { DraftPick } from '@/lib/types';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from 'recharts';

interface DraftPickWithStats extends DraftPick {
  avg_score: number | null;
  total_score: number | null;
  rounds_played: number;
  rating: 'steal' | 'value' | 'fair' | 'bust' | 'unknown';
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
        .select('player_id, points, is_scoring');

      const playerStats: Record<number, { totalPts: number; count: number }> = {};
      playerRounds?.forEach((pr) => {
        if (pr.points != null && pr.is_scoring) {
          if (!playerStats[pr.player_id]) playerStats[pr.player_id] = { totalPts: 0, count: 0 };
          playerStats[pr.player_id].totalPts += Number(pr.points);
          playerStats[pr.player_id].count++;
        }
      });

      // Compute expected avg by pick position (simple linear model)
      const allAvgs = draftPicks.map((p) => {
        const stats = playerStats[p.player_id];
        return stats ? stats.totalPts / stats.count : null;
      }).filter((a): a is number => a !== null);

      const overallAvg = allAvgs.length > 0 ? allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length : 0;

      const enriched: DraftPickWithStats[] = draftPicks.map((pick) => {
        const stats = playerStats[pick.player_id];
        const avg = stats ? Math.round(stats.totalPts / stats.count) : null;
        const total = stats ? Math.round(stats.totalPts) : null;
        const rounds = stats?.count || 0;

        // Rating based on pick position vs performance
        let rating: DraftPickWithStats['rating'] = 'unknown';
        if (avg !== null && rounds >= 2) {
          // Expected avg drops ~0.5 per pick from overall avg
          const expectedAvg = overallAvg + (50 - pick.overall_pick) * 0.5;
          const diff = avg - expectedAvg;
          if (diff > 15) rating = 'steal';
          else if (diff > 5) rating = 'value';
          else if (diff > -10) rating = 'fair';
          else rating = 'bust';
        }

        return { ...pick, avg_score: avg, total_score: total, rounds_played: rounds, rating };
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

  // Scatter chart data
  const scatterData = picks
    .filter((p) => p.avg_score !== null)
    .map((p) => ({
      pick: p.overall_pick,
      avg: p.avg_score,
      name: p.player_name,
      team: p.team_name,
      rating: p.rating,
    }));

  return (
    <div className="space-y-6">
      {/* View toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setViewMode('board')}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
            viewMode === 'board'
              ? 'bg-primary text-primary-foreground'
              : 'bg-card border border-border hover:bg-muted/50'
          )}
        >
          Draft Board
        </button>
        <button
          onClick={() => setViewMode('chart')}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
            viewMode === 'chart'
              ? 'bg-primary text-primary-foreground'
              : 'bg-card border border-border hover:bg-muted/50'
          )}
        >
          Pick Value Chart
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {['steal', 'value', 'fair', 'bust'].map((r) => (
          <div key={r} className="flex items-center gap-1.5">
            <div className={cn('w-3 h-3 rounded-sm border', ratingColors[r])} />
            <span className="capitalize text-muted-foreground">{r}</span>
          </div>
        ))}
      </div>

      {viewMode === 'board' ? (
        /* Draft Board Table */
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground sticky left-0 bg-muted/50 z-10 w-14">
                    Rd
                  </th>
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
                    <td className="px-3 py-2 font-semibold text-muted-foreground sticky left-0 bg-card z-10">
                      {round}
                    </td>
                    {teamOrder.map((teamId) => {
                      const pick = picks.find((p) => p.round === round && p.team_id === teamId);
                      if (!pick) return <td key={teamId} className="px-2 py-2 text-center text-muted-foreground">—</td>;
                      return (
                        <td key={teamId} className="px-2 py-2">
                          <div className={cn('rounded-md p-1.5 border text-center', ratingColors[pick.rating])}>
                            <p className="font-medium truncate">{pick.player_name}</p>
                            <p className="text-[10px] opacity-70">
                              {pick.avg_score !== null ? `Avg: ${pick.avg_score}` : 'No data'}
                              {pick.position ? ` · ${pick.position}` : ''}
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
        /* Scatter Chart: Pick # vs Avg Score */
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-1">Draft Pick vs Average Score</h3>
          <p className="text-xs text-muted-foreground mb-4">Each dot is a drafted player. Color indicates value rating.</p>
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
                dataKey="avg"
                name="Avg Score"
                tick={{ fontSize: 12 }}
                label={{ value: 'Avg Score', angle: -90, position: 'insideLeft', fontSize: 12 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-bold">{d.name}</p>
                      <p className="text-muted-foreground">{d.team}</p>
                      <p>Pick #{d.pick} · Avg: {d.avg}</p>
                      <p className="capitalize font-medium" style={{ color: ratingDotColors[d.rating] }}>{d.rating}</p>
                    </div>
                  );
                }}
              />
              <Scatter data={scatterData}>
                {scatterData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={ratingDotColors[entry.rating]}
                    fillOpacity={0.8}
                    r={5}
                  />
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
          </div>
          <div className="divide-y divide-border">
            {picks
              .filter((p) => p.rating === 'steal')
              .sort((a, b) => (b.avg_score || 0) - (a.avg_score || 0))
              .slice(0, 8)
              .map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs font-mono text-muted-foreground w-8">#{p.overall_pick}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.player_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.team_name}</p>
                  </div>
                  <span className="text-sm font-bold text-green-600">Avg {p.avg_score}</span>
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
          </div>
          <div className="divide-y divide-border">
            {picks
              .filter((p) => p.rating === 'bust')
              .sort((a, b) => (a.avg_score || 999) - (b.avg_score || 999))
              .slice(0, 8)
              .map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs font-mono text-muted-foreground w-8">#{p.overall_pick}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.player_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.team_name}</p>
                  </div>
                  <span className="text-sm font-bold text-red-600">Avg {p.avg_score}</span>
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
