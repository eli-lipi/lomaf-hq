'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn, formatScore } from '@/lib/utils';
import type { DraftPick } from '@/lib/types';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';

// Team abbreviations for compact draft board
const TEAM_ABBREV: Record<number, string> = {
  3194002: 'Mansion', 3194005: 'STAD', 3194009: 'SEANO', 3194003: 'LIPI',
  3194006: 'Melech', 3194010: 'CDL', 3194008: 'TMHCR', 3194001: 'Doge',
  3194004: 'Gun M', 3194007: 'Warner',
};

const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#1A56DB', 3194005: '#DC2626', 3194009: '#16A34A', 3194003: '#F59E0B',
  3194006: '#9333EA', 3194010: '#0891B2', 3194008: '#EA580C', 3194001: '#DB2777',
  3194004: '#4F46E5', 3194007: '#059669',
};

// Position benchmarks — forwards/rucks more scarce
const POS_BENCHMARKS: Record<string, { elite: number; good: number; avg: number }> = {
  MID: { elite: 110, good: 95, avg: 80 },
  DEF: { elite: 100, good: 85, avg: 70 },
  FWD: { elite: 90, good: 75, avg: 60 },
  RUC: { elite: 95, good: 80, avg: 65 },
};

function getPosGroup(pos: string | null): string {
  if (!pos) return 'MID';
  const p = pos.toUpperCase();
  if (p.includes('DEF')) return 'DEF';
  if (p.includes('FWD')) return 'FWD';
  if (p.includes('RUC') || p.includes('RUCK')) return 'RUC';
  return 'MID';
}

type Rating = 'steal' | 'value' | 'fair' | 'bust' | 'unknown';

interface DraftPickEnriched {
  id: string; round: number; round_pick: number; overall_pick: number;
  team_name: string; team_id: number; player_name: string; player_id: number;
  position: string | null; posGroup: string;
  avg_score: number | null; total_score: number | null; rounds_played: number;
  rating: Rating; posAvgDiff: number | null;
}

const RATING_COLORS: Record<Rating, string> = {
  steal: 'bg-green-100 text-green-800 border-green-300',
  value: 'bg-blue-100 text-blue-700 border-blue-300',
  fair: 'bg-gray-100 text-gray-600 border-gray-300',
  bust: 'bg-red-100 text-red-700 border-red-300',
  unknown: 'bg-gray-50 text-gray-400 border-gray-200',
};

const RATING_DOT_COLORS: Record<Rating, string> = {
  steal: '#16A34A', value: '#2563EB', fair: '#6B7280', bust: '#DC2626', unknown: '#D1D5DB',
};

export default function DraftTab() {
  const [picks, setPicks] = useState<DraftPickEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'board' | 'chart' | 'value'>('board');
  const [filterTeam, setFilterTeam] = useState<number | null>(null);

  useEffect(() => { loadDraftData(); }, []);

  const loadDraftData = async () => {
    try {
      const { data: rawPicks } = await supabase
        .from('draft_picks')
        .select('*')
        .order('overall_pick', { ascending: true });

      if (!rawPicks || rawPicks.length === 0) { setLoading(false); return; }

      // Deduplicate: keep one per player_id+team_id
      const seen = new Set<string>();
      const draftPicks: DraftPick[] = [];
      for (const p of rawPicks) {
        const key = `${p.player_id}-${p.team_id}`;
        if (!seen.has(key)) {
          seen.add(key);
          draftPicks.push(p);
        }
      }

      // Get player stats from player_rounds
      const allPlayerRounds: { player_id: number; points: number | null; is_scoring: boolean; pos: string }[] = [];
      let offset = 0;
      while (true) {
        const { data } = await supabase
          .from('player_rounds')
          .select('player_id, points, is_scoring, pos')
          .range(offset, offset + 999);
        if (!data || data.length === 0) break;
        allPlayerRounds.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
      }

      const playerStats: Record<number, { totalPts: number; count: number }> = {};
      allPlayerRounds.forEach(pr => {
        if (pr.points != null && pr.is_scoring && Number(pr.points) > 0) {
          if (!playerStats[pr.player_id]) playerStats[pr.player_id] = { totalPts: 0, count: 0 };
          playerStats[pr.player_id].totalPts += Number(pr.points);
          playerStats[pr.player_id].count++;
        }
      });

      const enriched: DraftPickEnriched[] = draftPicks.map(pick => {
        const stats = playerStats[pick.player_id];
        const avg = stats && stats.count >= 1 ? Math.round(stats.totalPts / stats.count) : null;
        const total = stats ? Math.round(stats.totalPts) : null;
        const rounds = stats?.count || 0;
        const posGroup = getPosGroup(pick.position);
        const benchmark = POS_BENCHMARKS[posGroup] || POS_BENCHMARKS.MID;
        const posAvgDiff = avg !== null ? avg - benchmark.avg : null;

        let rating: Rating = 'unknown';
        if (avg !== null && rounds >= 1) {
          const isTopPick = pick.overall_pick <= 20;
          const isTop10 = pick.overall_pick <= 10;

          // Tiered benchmarks: top-10 picks need higher scores, top-20 slightly higher
          const eliteThresh = isTop10 ? benchmark.elite + 15 : isTopPick ? benchmark.elite + 10 : benchmark.elite;
          const goodThresh = isTop10 ? benchmark.good + 15 : isTopPick ? benchmark.good + 10 : benchmark.good;

          if (avg >= eliteThresh) {
            rating = 'steal';
          } else if (avg >= goodThresh) {
            rating = 'value';
          } else if (avg >= benchmark.avg) {
            rating = 'fair';
          } else {
            const deficit = benchmark.avg - avg;
            if (deficit > 20 || (isTop10 && deficit > 10) || (isTopPick && deficit > 15)) {
              rating = 'bust';
            } else {
              rating = 'fair';
            }
          }
        }

        return {
          id: pick.id, round: pick.round, round_pick: pick.round_pick, overall_pick: pick.overall_pick,
          team_name: pick.team_name, team_id: pick.team_id, player_name: pick.player_name,
          player_id: pick.player_id, position: pick.position, posGroup,
          avg_score: avg, total_score: total, rounds_played: rounds, rating, posAvgDiff,
        };
      });

      setPicks(enriched);
    } catch (err) {
      console.error('Failed to load draft data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Draft order: determined by Round 1 pick order
  const draftOrder = useMemo(() => {
    const r1Picks = picks.filter(p => p.round === 1).sort((a, b) => a.round_pick - b.round_pick);
    return r1Picks.map(p => p.team_id);
  }, [picks]);

  // Value list (combined steals + busts, sorted by posAvgDiff)
  const valueList = useMemo(() => {
    return picks
      .filter(p => p.rating !== 'unknown' && p.rating !== 'fair' && p.posAvgDiff !== null)
      .sort((a, b) => (b.posAvgDiff || 0) - (a.posAvgDiff || 0));
  }, [picks]);

  // Scatter data
  const scatterData = useMemo(() => {
    let data = picks.filter(p => p.avg_score !== null && p.posAvgDiff !== null);
    if (filterTeam) data = data.filter(p => p.team_id === filterTeam);
    return data.map(p => ({
      pick: p.overall_pick, avg: p.avg_score, posAvgDiff: p.posAvgDiff,
      name: p.player_name, team: p.team_name, teamId: p.team_id,
      rating: p.rating, pos: p.posGroup,
    }));
  }, [picks, filterTeam]);

  if (loading) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Loading draft data...</p></div>;
  if (picks.length === 0) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Upload draft data to see draft vs reality analysis.</p></div>;

  const maxRound = Math.max(...picks.map(p => p.round));
  const draftRounds = Array.from({ length: maxRound }, (_, i) => i + 1);
  const posColors: Record<string, string> = { DEF: 'text-blue-600', MID: 'text-green-600', FWD: 'text-red-600', RUC: 'text-purple-600' };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {(['board', 'chart', 'value'] as const).map(mode => (
          <button key={mode} onClick={() => setViewMode(mode)}
            className={cn('px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize',
              viewMode === mode ? 'bg-primary text-primary-foreground' : 'bg-card border border-border hover:bg-muted/50')}>
            {mode === 'board' ? 'Draft Board' : mode === 'chart' ? 'Value Chart' : 'Steals & Busts'}
          </button>
        ))}
        <div className="flex flex-wrap gap-3 text-xs ml-auto">
          {(['steal', 'value', 'fair', 'bust'] as const).map(r => (
            <div key={r} className="flex items-center gap-1.5">
              <div className={cn('w-3 h-3 rounded-sm border', RATING_COLORS[r])} />
              <span className="capitalize text-muted-foreground">{r}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Position benchmarks */}
      <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Position-adjusted ratings: </span>
        {Object.entries(POS_BENCHMARKS).map(([pos, b]) => (
          <span key={pos} className="mr-3">
            <strong className={posColors[pos]}>{pos}</strong> Elite {b.elite}+ / Good {b.good}+ / Avg {b.avg}+
          </span>
        ))}
        <span className="block mt-1">Top-10 picks need +15 above benchmarks, top-20 need +10 to rate as steal/value.</span>
      </div>

      {/* === DRAFT BOARD === */}
      {viewMode === 'board' && (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground w-8 sticky left-0 bg-muted/50 z-10">Rd</th>
                  {draftOrder.map(teamId => (
                    <th key={teamId} className="px-1 py-2 text-center font-bold text-muted-foreground" style={{ width: `${92 / draftOrder.length}%` }}>
                      {TEAM_ABBREV[teamId] || 'Team'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draftRounds.map(round => (
                  <tr key={round} className={round % 2 === 0 ? 'bg-muted/10' : ''}>
                    <td className="px-2 py-1.5 font-bold text-muted-foreground sticky left-0 bg-card z-10">{round}</td>
                    {draftOrder.map(teamId => {
                      const pick = picks.find(p => p.round === round && p.team_id === teamId);
                      if (!pick) return <td key={teamId} className="px-1 py-1.5 text-center text-muted-foreground">—</td>;
                      return (
                        <td key={teamId} className="px-1 py-1.5">
                          <div className={cn('rounded p-1 border text-center', RATING_COLORS[pick.rating])}>
                            <p className="font-semibold truncate leading-tight">{pick.player_name}</p>
                            <p className="text-[9px] opacity-80 leading-tight">
                              {pick.avg_score !== null ? `${pick.avg_score}` : '—'}
                              <span className={posColors[pick.posGroup] || ''}> {pick.posGroup}</span>
                              {pick.posAvgDiff !== null && (
                                <span className={pick.posAvgDiff > 0 ? 'text-green-700' : 'text-red-700'}>
                                  {' '}{pick.posAvgDiff > 0 ? '+' : ''}{pick.posAvgDiff}
                                </span>
                              )}
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
      )}

      {/* === VALUE CHART === */}
      {viewMode === 'chart' && (
        <div className="space-y-4">
          {/* Team filter for chart */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilterTeam(null)}
              className={cn('px-3 py-1.5 text-xs rounded-lg transition-colors',
                !filterTeam ? 'bg-primary text-primary-foreground' : 'bg-card border border-border hover:bg-muted/50')}>
              All Teams
            </button>
            {TEAMS.map(t => (
              <button key={t.team_id} onClick={() => setFilterTeam(prev => prev === t.team_id ? null : t.team_id)}
                className={cn('px-3 py-1.5 text-xs rounded-lg transition-colors border',
                  filterTeam === t.team_id ? 'text-white' : 'bg-card border-border hover:bg-muted/50')}
                style={filterTeam === t.team_id ? { backgroundColor: TEAM_COLOR_MAP[t.team_id] } : {}}>
                {TEAM_ABBREV[t.team_id]}
              </button>
            ))}
          </div>

          <div className="bg-card border border-border rounded-lg shadow-sm p-5">
            <h3 className="font-semibold mb-1">Draft Pick vs Position-Adjusted Score</h3>
            <p className="text-xs text-muted-foreground mb-4">Y-axis: performance above/below position average. Dot size = draft pick value.</p>
            <ResponsiveContainer width="100%" height={420}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="pick" name="Pick #" tick={{ fontSize: 12 }}
                  ticks={[1, 10, 20, 30, 40, 50, 60, 70, 80, 100, 120, 150, 180, 200, 250]}
                  label={{ value: 'Overall Pick', position: 'insideBottom', offset: -5, fontSize: 12 }} />
                <YAxis dataKey="posAvgDiff" name="vs Pos Avg" tick={{ fontSize: 12 }}
                  label={{ value: 'vs Position Average', angle: -90, position: 'insideLeft', fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="5 5" />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-bold">{d.name}</p>
                      <p className="text-muted-foreground">{d.team} · {d.pos}</p>
                      <p>Pick #{d.pick} · Avg: {d.avg}</p>
                      <p>{d.posAvgDiff > 0 ? '+' : ''}{d.posAvgDiff} vs {d.pos} average</p>
                      <p className="capitalize font-medium" style={{ color: RATING_DOT_COLORS[d.rating as Rating] }}>{d.rating}</p>
                    </div>
                  );
                }} />
                <Scatter data={scatterData}>
                  {scatterData.map((entry, i) => (
                    <Cell key={i}
                      fill={filterTeam ? TEAM_COLOR_MAP[entry.teamId] || '#6B7280' : RATING_DOT_COLORS[entry.rating]}
                      fillOpacity={0.85} r={5} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* === COMBINED STEALS & BUSTS === */}
      {viewMode === 'value' && (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Draft Value Rankings</h3>
            <p className="text-xs text-muted-foreground mt-1">Sorted by value differential — steals at top, busts at bottom</p>
          </div>
          <div className="divide-y divide-border">
            {valueList.map((p, i) => (
              <div key={p.id} className={cn('flex items-center gap-3 px-4 py-2.5',
                p.rating === 'steal' ? 'bg-green-50/50' :
                p.rating === 'value' ? 'bg-blue-50/50' :
                p.rating === 'bust' ? 'bg-red-50/50' : '')}>
                <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}</span>
                <span className={cn('text-xs px-1.5 py-0.5 rounded border font-semibold capitalize shrink-0', RATING_COLORS[p.rating])}>
                  {p.rating}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.player_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {p.team_name} · Rd {p.round} Pick #{p.overall_pick} · {p.posGroup}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold">Avg {p.avg_score}</p>
                  <p className={cn('text-xs font-semibold',
                    (p.posAvgDiff || 0) > 0 ? 'text-green-600' : 'text-red-600')}>
                    {(p.posAvgDiff || 0) > 0 ? '+' : ''}{p.posAvgDiff} vs pos avg
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
