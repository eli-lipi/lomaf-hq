'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { DraftPick } from '@/lib/types';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import {
  DEFAULT_CONFIG, getRoundScale, loadDraftBoardConfig, saveDraftBoardConfig,
  type DraftBoardConfig, type RoundBracket, type Tier,
} from '@/lib/draft-board-config';

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

function getPosGroup(pos: string | null): 'MID' | 'DEF' | 'FWD' | 'RUC' {
  if (!pos) return 'MID';
  const p = pos.toUpperCase();
  if (p.includes('DEF')) return 'DEF';
  if (p.includes('FWD')) return 'FWD';
  if (p.includes('RUC') || p.includes('RUCK')) return 'RUC';
  return 'MID';
}

type PosKey = 'MID' | 'DEF' | 'FWD' | 'RUC';
type Rating = 'steal' | 'value' | 'fair' | 'bust' | 'unknown';

interface DraftPickRaw {
  id: string; round: number; round_pick: number; overall_pick: number;
  team_name: string; team_id: number; player_name: string; player_id: number;
  position: string | null; posGroup: PosKey;
  avg_score: number | null; total_score: number | null; rounds_played: number;
  max_rounds: number; availability: number;
}

interface DraftPickEnriched extends DraftPickRaw {
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

const POS_KEYS: PosKey[] = ['MID', 'DEF', 'FWD', 'RUC'];
const TIER_KEYS: (keyof Tier)[] = ['elite', 'good', 'avg'];

function applyRating(raw: DraftPickRaw, config: DraftBoardConfig): DraftPickEnriched {
  const benchmark = config.benchmarks[raw.posGroup];
  const avg = raw.avg_score;
  const posAvgDiff = avg !== null ? avg - benchmark.avg : null;

  let rating: Rating = 'unknown';
  if (avg !== null && raw.rounds_played >= 1) {
    const scale = getRoundScale(raw.round, config.round_brackets);
    const eliteThresh = Math.round(benchmark.elite * scale);
    const goodThresh = Math.round(benchmark.good * scale);
    const avgThresh = Math.round(benchmark.avg * scale);
    const bustDeficit = raw.round <= 2 ? 10 : raw.round <= 4 ? 15 : 20;

    let baseRating: Rating;
    if (avg >= eliteThresh) baseRating = 'steal';
    else if (avg >= goodThresh) baseRating = 'value';
    else if (avg >= avgThresh) baseRating = 'fair';
    else baseRating = (avgThresh - avg > bustDeficit) ? 'bust' : 'fair';

    const { bust_below_pct, cap_fair_below_pct, demote_below_pct } = config.availability;
    const availPct = raw.availability * 100;
    if (availPct < bust_below_pct) {
      rating = 'bust';
    } else if (availPct < cap_fair_below_pct) {
      rating = (baseRating === 'steal' || baseRating === 'value') ? 'fair' : baseRating;
    } else if (availPct < demote_below_pct) {
      if (baseRating === 'steal') rating = 'value';
      else if (baseRating === 'value') rating = 'fair';
      else rating = baseRating;
    } else {
      rating = baseRating;
    }
  }

  return { ...raw, rating, posAvgDiff };
}

export default function DraftTab({ isAdmin }: { isAdmin: boolean }) {
  const [rawPicks, setRawPicks] = useState<DraftPickRaw[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'board' | 'chart' | 'value'>('board');
  const [filterTeam, setFilterTeam] = useState<number | null>(null);
  const [config, setConfig] = useState<DraftBoardConfig>(DEFAULT_CONFIG);

  useEffect(() => { loadDraftData(); }, []);
  useEffect(() => { loadDraftBoardConfig().then(setConfig); }, []);

  const loadDraftData = async () => {
    try {
      const { data: rawPicksData } = await supabase
        .from('draft_picks')
        .select('*')
        .order('overall_pick', { ascending: true });

      if (!rawPicksData || rawPicksData.length === 0) { setLoading(false); return; }

      const seen = new Set<string>();
      const draftPicks: DraftPick[] = [];
      for (const p of rawPicksData) {
        const key = `${p.player_id}-${p.team_id}`;
        if (!seen.has(key)) { seen.add(key); draftPicks.push(p); }
      }

      const allPlayerRounds: { player_id: number; points: number | null; round_number: number }[] = [];
      let offset = 0;
      while (true) {
        const { data } = await supabase
          .from('player_rounds')
          .select('player_id, points, round_number')
          .range(offset, offset + 999);
        if (!data || data.length === 0) break;
        allPlayerRounds.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
      }

      const playerRoundMap: Record<number, Map<number, number>> = {};
      let maxRound = 0;
      allPlayerRounds.forEach(pr => {
        if (pr.round_number > maxRound) maxRound = pr.round_number;
        if (pr.points == null || Number(pr.points) <= 0) return;
        if (!playerRoundMap[pr.player_id]) playerRoundMap[pr.player_id] = new Map();
        const bucket = playerRoundMap[pr.player_id];
        const existing = bucket.get(pr.round_number);
        const pts = Number(pr.points);
        if (existing == null || pts > existing) bucket.set(pr.round_number, pts);
      });

      const playerStats: Record<number, { totalPts: number; count: number }> = {};
      for (const [pid, rounds] of Object.entries(playerRoundMap)) {
        let total = 0;
        rounds.forEach(pts => { total += pts; });
        playerStats[Number(pid)] = { totalPts: total, count: rounds.size };
      }

      const raw: DraftPickRaw[] = draftPicks.map(pick => {
        const stats = playerStats[pick.player_id];
        const avg = stats && stats.count >= 1 ? Math.round(stats.totalPts / stats.count) : null;
        const total = stats ? Math.round(stats.totalPts) : null;
        const rounds = stats?.count || 0;
        return {
          id: pick.id, round: pick.round, round_pick: pick.round_pick, overall_pick: pick.overall_pick,
          team_name: pick.team_name, team_id: pick.team_id, player_name: pick.player_name,
          player_id: pick.player_id, position: pick.position, posGroup: getPosGroup(pick.position),
          avg_score: avg, total_score: total, rounds_played: rounds,
          max_rounds: maxRound, availability: maxRound > 0 ? rounds / maxRound : 0,
        };
      });

      setRawPicks(raw);
    } catch (err) {
      console.error('Failed to load draft data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Re-apply rating whenever raw picks or config change — no re-fetch needed.
  const picks = useMemo(
    () => rawPicks.map(p => applyRating(p, config)),
    [rawPicks, config]
  );

  const draftOrder = useMemo(() => {
    const r1Picks = picks.filter(p => p.round === 1).sort((a, b) => a.round_pick - b.round_pick);
    return r1Picks.map(p => p.team_id);
  }, [picks]);

  const valueList = useMemo(() => {
    return picks
      .filter(p => p.rating !== 'unknown' && p.rating !== 'fair' && p.posAvgDiff !== null)
      .sort((a, b) => (b.posAvgDiff || 0) - (a.posAvgDiff || 0));
  }, [picks]);

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

  const maxDraftRound = Math.max(...picks.map(p => p.round));
  const draftRounds = Array.from({ length: maxDraftRound }, (_, i) => i + 1);
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

      {/* Benchmarks panel (admin-editable) */}
      <BenchmarksPanel
        config={config}
        onSave={async (next) => {
          setConfig(next);
          await saveDraftBoardConfig(next);
        }}
        isAdmin={isAdmin}
        posColors={posColors}
      />

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
                              {pick.max_rounds > 0 && (
                                <span className={pick.availability < 0.5 ? 'text-red-700' : pick.availability < 0.75 ? 'text-amber-700' : 'text-gray-600'}>
                                  {' '}·{' '}{pick.rounds_played}/{pick.max_rounds}
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

// ===== Benchmarks Panel =====

function BenchmarksPanel({
  config, onSave, isAdmin, posColors,
}: {
  config: DraftBoardConfig;
  onSave: (next: DraftBoardConfig) => Promise<void>;
  isAdmin: boolean;
  posColors: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftBoardConfig>(config);
  const [saving, setSaving] = useState(false);

  // Keep draft in sync with latest config when not editing.
  useEffect(() => { if (!editing) setDraft(config); }, [config, editing]);

  if (!editing) {
    const bracketPillStyle = (pct: number) =>
      pct > 0 ? 'bg-red-50 text-red-700 border-red-200'
        : pct < 0 ? 'bg-green-50 text-green-700 border-green-200'
        : 'bg-gray-50 text-gray-600 border-gray-200';
    const bracketRange = (b: RoundBracket) =>
      b.to >= 999 ? `R${b.from}+` : b.from === b.to ? `R${b.from}` : `R${b.from}–${b.to}`;

    return (
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
          <h3 className="text-sm font-semibold">Rating Reference</h3>
          {isAdmin && (
            <button
              onClick={() => { setDraft(config); setEditing(true); }}
              className="px-3 py-1 text-xs font-medium rounded-md bg-card border border-border hover:bg-muted/50 text-foreground"
            >
              Edit
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] divide-y md:divide-y-0 md:divide-x divide-border">
          {/* Benchmarks table */}
          <div className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Benchmarks (per-game avg)</p>
            <table className="text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pr-4 pb-1"></th>
                  <th className="text-right font-medium px-2 pb-1">Elite</th>
                  <th className="text-right font-medium px-2 pb-1">Good</th>
                  <th className="text-right font-medium pl-2 pb-1">Avg</th>
                </tr>
              </thead>
              <tbody>
                {POS_KEYS.map(pos => {
                  const b = config.benchmarks[pos];
                  return (
                    <tr key={pos}>
                      <td className={cn('font-bold pr-4 py-0.5', posColors[pos])}>{pos}</td>
                      <td className="text-right tabular-nums px-2 py-0.5">{b.elite}+</td>
                      <td className="text-right tabular-nums px-2 py-0.5">{b.good}+</td>
                      <td className="text-right tabular-nums pl-2 py-0.5">{b.avg}+</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Round scaling */}
          <div className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Round scaling</p>
            <div className="flex flex-wrap gap-1.5">
              {config.round_brackets.map((b, i) => (
                <span
                  key={i}
                  className={cn(
                    'inline-flex items-baseline gap-1 px-2 py-1 rounded-md border text-xs',
                    bracketPillStyle(b.scale_pct)
                  )}
                >
                  <span className="font-semibold tabular-nums">{bracketRange(b)}</span>
                  <span className="tabular-nums text-[11px]">
                    {b.scale_pct > 0 ? `+${b.scale_pct}%` : b.scale_pct < 0 ? `${b.scale_pct}%` : '—'}
                  </span>
                </span>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Positive = tougher to rate well. Negative = easier.</p>
          </div>

          {/* Availability */}
          <div className="p-4 md:min-w-[200px]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Availability penalty</p>
            <ul className="space-y-1 text-xs">
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-sm bg-red-400 shrink-0" />
                <span className="tabular-nums font-semibold">&lt;{config.availability.bust_below_pct}%</span>
                <span className="text-muted-foreground">→ Bust</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-sm bg-gray-400 shrink-0" />
                <span className="tabular-nums font-semibold">&lt;{config.availability.cap_fair_below_pct}%</span>
                <span className="text-muted-foreground">→ Cap at Fair</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-sm bg-amber-400 shrink-0" />
                <span className="tabular-nums font-semibold">&lt;{config.availability.demote_below_pct}%</span>
                <span className="text-muted-foreground">→ Demote one tier</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // --- Edit mode ---
  const setBenchmark = (pos: PosKey, tier: keyof Tier, value: number) => {
    setDraft(d => ({ ...d, benchmarks: { ...d.benchmarks, [pos]: { ...d.benchmarks[pos], [tier]: value } } }));
  };
  const setBracket = (idx: number, patch: Partial<RoundBracket>) => {
    setDraft(d => ({
      ...d,
      round_brackets: d.round_brackets.map((b, i) => i === idx ? { ...b, ...patch } : b),
    }));
  };
  const setAvail = (key: keyof DraftBoardConfig['availability'], value: number) => {
    setDraft(d => ({ ...d, availability: { ...d.availability, [key]: value } }));
  };

  return (
    <div className="bg-muted/30 rounded-lg p-4 text-xs space-y-4">
      {/* Position benchmarks */}
      <div>
        <div className="font-medium text-foreground mb-2">Position benchmarks</div>
        <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-2 items-center max-w-xl">
          <div></div>
          {TIER_KEYS.map(t => <div key={t} className="text-center text-muted-foreground capitalize">{t}</div>)}
          {POS_KEYS.map(pos => (
            <FragmentRow key={pos}>
              <div className={cn('font-bold', posColors[pos])}>{pos}</div>
              {TIER_KEYS.map(tier => (
                <input
                  key={tier}
                  type="number"
                  value={draft.benchmarks[pos][tier]}
                  onChange={e => setBenchmark(pos, tier, Number(e.target.value))}
                  className="px-2 py-1 rounded border border-border bg-card text-sm text-center"
                />
              ))}
            </FragmentRow>
          ))}
        </div>
      </div>

      {/* Round brackets */}
      <div>
        <div className="font-medium text-foreground mb-2">Round-based scaling (% adjustment to benchmarks)</div>
        <div className="space-y-2 max-w-xl">
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-muted-foreground">
            <div>From round</div><div>To round</div><div>Scale %</div>
          </div>
          {draft.round_brackets.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr] gap-2">
              <input type="number" value={b.from} onChange={e => setBracket(i, { from: Number(e.target.value) })}
                className="px-2 py-1 rounded border border-border bg-card text-sm" />
              <input type="number" value={b.to} onChange={e => setBracket(i, { to: Number(e.target.value) })}
                className="px-2 py-1 rounded border border-border bg-card text-sm" />
              <input type="number" value={b.scale_pct} onChange={e => setBracket(i, { scale_pct: Number(e.target.value) })}
                className="px-2 py-1 rounded border border-border bg-card text-sm" />
            </div>
          ))}
          <p className="text-muted-foreground">Tip: use a large value (e.g. 999) for &quot;and later&quot;. Brackets must not overlap.</p>
        </div>
      </div>

      {/* Availability */}
      <div>
        <div className="font-medium text-foreground mb-2">Availability penalty thresholds (% of games played)</div>
        <div className="grid grid-cols-3 gap-3 max-w-xl">
          <label className="block">
            <span className="block text-muted-foreground mb-1">Bust below</span>
            <input type="number" value={draft.availability.bust_below_pct}
              onChange={e => setAvail('bust_below_pct', Number(e.target.value))}
              className="w-full px-2 py-1 rounded border border-border bg-card text-sm" />
          </label>
          <label className="block">
            <span className="block text-muted-foreground mb-1">Cap at fair below</span>
            <input type="number" value={draft.availability.cap_fair_below_pct}
              onChange={e => setAvail('cap_fair_below_pct', Number(e.target.value))}
              className="w-full px-2 py-1 rounded border border-border bg-card text-sm" />
          </label>
          <label className="block">
            <span className="block text-muted-foreground mb-1">Demote one tier below</span>
            <input type="number" value={draft.availability.demote_below_pct}
              onChange={e => setAvail('demote_below_pct', Number(e.target.value))}
              className="w-full px-2 py-1 rounded border border-border bg-card text-sm" />
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try { await onSave(draft); setEditing(false); }
            finally { setSaving(false); }
          }}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          disabled={saving}
          onClick={() => { setDraft(config); setEditing(false); }}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-card border border-border hover:bg-muted/50"
        >
          Cancel
        </button>
        <button
          disabled={saving}
          onClick={() => setDraft(DEFAULT_CONFIG)}
          className="px-3 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground ml-auto"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

// Small helper so the benchmarks grid can render rows of 4 cells (pos label + 3 tiers).
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
