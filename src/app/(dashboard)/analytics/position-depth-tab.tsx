'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { TEAM_COLOR_MAP, TEAM_SHORT_NAMES } from '@/lib/team-colors';
import { cn } from '@/lib/utils';

// ─── Tiers ──────────────────────────────────────────────────────────────────
// Average buckets — half-open intervals [min, max). The catch-all '<70'
// uses min=0 so untested players (avg=0) land there, not in their own
// orphan bucket.
type TierId = '100+' | '90s' | '80s' | '70s' | '<70';
const TIERS: { id: TierId; label: string; min: number; max: number }[] = [
  { id: '100+', label: '100+', min: 100, max: Infinity },
  { id: '90s', label: '90–99', min: 90, max: 100 },
  { id: '80s', label: '80–89', min: 80, max: 90 },
  { id: '70s', label: '70–79', min: 70, max: 80 },
  { id: '<70', label: '<70', min: 0, max: 70 },
];

function classifyTier(avg: number): TierId {
  for (const t of TIERS) {
    if (avg >= t.min && avg < t.max) return t.id;
  }
  return '<70';
}

// ─── Positions ──────────────────────────────────────────────────────────────
// Hierarchy (user's rule): a player with any FWD eligibility resolves
// as Forward; otherwise DEF wins; otherwise RUC; otherwise MID. This
// matches AFL Fantasy convention where DPP players are usually played
// in their scarcer slot (forwards/rucks are scarce).
type Position = 'FWD' | 'DEF' | 'RUC' | 'MID';
const POSITION_ORDER: Position[] = ['FWD', 'DEF', 'RUC', 'MID'];

function classifyPosition(raw: string): Position {
  const parts = raw.toUpperCase().split(/[\s/,|]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.startsWith('FWD') || p.startsWith('FOR'))) return 'FWD';
  if (parts.some((p) => p.startsWith('DEF') || p.startsWith('BAC'))) return 'DEF';
  if (parts.some((p) => p.startsWith('RUC') || p.startsWith('RUK'))) return 'RUC';
  return 'MID';
}

const POSITION_META: Record<Position, { label: string; color: string; bg: string }> = {
  FWD: { label: 'Forwards', color: '#DC2626', bg: 'rgba(220,38,38,0.06)' },
  DEF: { label: 'Defenders', color: '#1A56DB', bg: 'rgba(26,86,219,0.06)' },
  RUC: { label: 'Rucks', color: '#7C3AED', bg: 'rgba(124,58,237,0.06)' },
  MID: { label: 'Midfielders', color: '#059669', bg: 'rgba(5,150,105,0.06)' },
};

// ─── Types ──────────────────────────────────────────────────────────────────
interface RosterRow {
  team_id: number;
  player_id: number;
  player_name: string;
  position: Position;
  rawPosition: string;
  avg: number;
  tier: TierId;
}

export default function PositionDepthTab() {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestRound, setLatestRound] = useState<number>(0);
  const [sortMode, setSortMode] = useState<'depth' | 'team'>('depth');

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      // 1. Latest round.
      const { data: roundCheck } = await supabase
        .from('player_rounds')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1);
      if (!roundCheck || roundCheck.length === 0) {
        setLoading(false);
        return;
      }
      const maxRound = roundCheck[0].round_number;
      setLatestRound(maxRound);

      // 2. Rosters at the latest round (paginated).
      const rosters: { team_id: number; player_id: number; player_name: string }[] = [];
      let offset = 0;
      // Loop guard — Supabase REST capped at 1000 rows per request.
      while (true) {
        const { data: batch } = await supabase
          .from('player_rounds')
          .select('team_id, player_id, player_name')
          .eq('round_number', maxRound)
          .range(offset, offset + 999);
        if (!batch || batch.length === 0) break;
        rosters.push(...batch);
        if (batch.length < 1000) break;
        offset += 1000;
      }

      // 3. Position lookup — draft_picks is the canonical source. We
      //    keep the first non-empty entry per player_id (dupes happen
      //    when a player gets traded mid-season).
      const { data: draftPicks } = await supabase
        .from('draft_picks')
        .select('player_id, position');
      const posByPlayer = new Map<number, string>();
      for (const dp of draftPicks ?? []) {
        if (dp.position && !posByPlayer.has(dp.player_id)) {
          posByPlayer.set(dp.player_id, dp.position);
        }
      }

      // 4. Season averages — `players.avg_pts` is the league-canonical
      //    season-to-date average (same field byes/injuries use).
      const { data: playersData } = await supabase
        .from('players')
        .select('player_id, avg_pts');
      const avgByPlayer = new Map<number, number>();
      for (const p of playersData ?? []) {
        if (p.avg_pts != null) avgByPlayer.set(p.player_id, p.avg_pts);
      }

      // 5. Assemble.
      const out: RosterRow[] = [];
      for (const r of rosters) {
        const rawPosition = posByPlayer.get(r.player_id) ?? 'MID';
        const avg = avgByPlayer.get(r.player_id) ?? 0;
        out.push({
          team_id: r.team_id,
          player_id: r.player_id,
          player_name: r.player_name,
          position: classifyPosition(rawPosition),
          rawPosition,
          avg: Math.round(avg),
          tier: classifyTier(avg),
        });
      }
      setRows(out);
    } catch (err) {
      console.error('PositionDepthTab load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  // Group rows by position → keyed by `${team_id}-${tier}`.
  const matricesByPos = useMemo(() => {
    const result: Record<Position, Map<string, RosterRow[]>> = {
      FWD: new Map(),
      DEF: new Map(),
      RUC: new Map(),
      MID: new Map(),
    };
    for (const r of rows) {
      const key = `${r.team_id}-${r.tier}`;
      const m = result[r.position];
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return result;
  }, [rows]);

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading position depth…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No roster data uploaded yet — heat map populates once a Points Grid is uploaded.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Intro panel — explains the lens and the sort toggle. */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold mb-1">Position depth heat map</h2>
            <p className="text-xs text-muted-foreground max-w-3xl">
              How each coach&apos;s roster is distributed across season-average tiers, split by
              position. Players with dual eligibility resolve as <strong>Forward → Defender → Ruck → Mid</strong>{' '}
              (forwards / rucks are scarcer, so DPPs land in their scarcer slot). Hover any cell to
              see the names. Darker cell = more players.
              {latestRound > 0 && (
                <span className="block mt-1 text-[10px] text-muted-foreground/80">
                  Rosters as of R{latestRound}. Averages from season-to-date.
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Sort</label>
            <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
              <button
                onClick={() => setSortMode('depth')}
                className={cn(
                  'px-2.5 py-1 transition-colors',
                  sortMode === 'depth' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted/40'
                )}
              >
                Depth
              </button>
              <button
                onClick={() => setSortMode('team')}
                className={cn(
                  'px-2.5 py-1 transition-colors border-l border-border',
                  sortMode === 'team' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted/40'
                )}
              >
                A→Z
              </button>
            </div>
          </div>
        </div>
      </div>

      {POSITION_ORDER.map((pos) => (
        <PositionMatrix
          key={pos}
          position={pos}
          meta={POSITION_META[pos]}
          matrix={matricesByPos[pos]}
          sortMode={sortMode}
        />
      ))}
    </div>
  );
}

// ─── Per-position matrix ────────────────────────────────────────────────────
function PositionMatrix({
  position,
  meta,
  matrix,
  sortMode,
}: {
  position: Position;
  meta: (typeof POSITION_META)[Position];
  matrix: Map<string, RosterRow[]>;
  sortMode: 'depth' | 'team';
}) {
  const { rowTotals, colTotals, grandTotal, maxCellCount } = useMemo(() => {
    const rowTotals = new Map<number, number>();
    const colTotals = new Map<TierId, number>();
    let grandTotal = 0;
    let maxCellCount = 0;
    for (const team of TEAMS) {
      let rowSum = 0;
      for (const tier of TIERS) {
        const key = `${team.team_id}-${tier.id}`;
        const count = matrix.get(key)?.length ?? 0;
        if (count > maxCellCount) maxCellCount = count;
        rowSum += count;
        colTotals.set(tier.id, (colTotals.get(tier.id) ?? 0) + count);
      }
      rowTotals.set(team.team_id, rowSum);
      grandTotal += rowSum;
    }
    return { rowTotals, colTotals, grandTotal, maxCellCount };
  }, [matrix]);

  const sortedTeams = useMemo(() => {
    if (sortMode === 'team') {
      return [...TEAMS].sort((a, b) => a.team_name.localeCompare(b.team_name));
    }
    // 'depth' — primary = total at this position desc, secondary =
    // weighted-by-tier (so two teams with 5 each are tiebroken by who
    // has more premiums). Lower tier ordinal = more premium.
    const tierOrdinal: Record<TierId, number> = { '100+': 4, '90s': 3, '80s': 2, '70s': 1, '<70': 0 };
    const weighted = (teamId: number) => {
      let w = 0;
      for (const tier of TIERS) {
        const count = matrix.get(`${teamId}-${tier.id}`)?.length ?? 0;
        w += count * tierOrdinal[tier.id];
      }
      return w;
    };
    return [...TEAMS].sort((a, b) => {
      const tDiff = (rowTotals.get(b.team_id) ?? 0) - (rowTotals.get(a.team_id) ?? 0);
      if (tDiff !== 0) return tDiff;
      return weighted(b.team_id) - weighted(a.team_id);
    });
  }, [sortMode, rowTotals, matrix]);

  // Opacity scale: 0 → blank, 1 → ~25%, max → ~75%.
  const cellOpacityPercent = (count: number): number => {
    if (count === 0 || maxCellCount === 0) return 0;
    return Math.round(25 + (count / maxCellCount) * 50);
  };

  return (
    <section
      className="bg-card border border-border rounded-lg shadow-sm overflow-hidden"
      style={{ borderTop: `3px solid ${meta.color}` }}
    >
      <header
        className="px-5 py-3 border-b border-border flex items-baseline justify-between flex-wrap gap-2"
        style={{ background: meta.bg }}
      >
        <h3 className="text-base font-bold" style={{ color: meta.color }}>
          {meta.label}
        </h3>
        <p className="text-xs text-muted-foreground">
          {grandTotal} player{grandTotal === 1 ? '' : 's'} across the league
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Coach
              </th>
              {TIERS.map((tier) => (
                <th
                  key={tier.id}
                  className="text-center px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-l border-border/40 tabular-nums"
                >
                  {tier.label}
                </th>
              ))}
              <th className="text-center px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-foreground border-l-2 border-border bg-muted/50">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((team) => {
              const teamColor = TEAM_COLOR_MAP[team.team_id] ?? '#6B7280';
              const total = rowTotals.get(team.team_id) ?? 0;
              return (
                <tr key={team.team_id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: teamColor }} />
                      <span className="text-sm font-bold truncate" style={{ color: teamColor }}>
                        {TEAM_SHORT_NAMES[team.team_id] ?? team.team_name}
                      </span>
                    </div>
                  </td>
                  {TIERS.map((tier) => {
                    const key = `${team.team_id}-${tier.id}`;
                    const players = matrix.get(key) ?? [];
                    const count = players.length;
                    const op = cellOpacityPercent(count);
                    const title =
                      count > 0
                        ? `${meta.label} · ${tier.label}\n${players
                            .sort((a, b) => b.avg - a.avg)
                            .map((p) => `• ${p.player_name} (${p.avg})${p.rawPosition !== position ? ` [${p.rawPosition}]` : ''}`)
                            .join('\n')}`
                        : `No ${meta.label.toLowerCase()} in ${tier.label}`;
                    return (
                      <td
                        key={tier.id}
                        className="text-center px-2 py-2.5 align-middle border-l border-border/40"
                        title={title}
                        style={
                          count > 0
                            ? { background: `color-mix(in srgb, ${meta.color} ${op}%, transparent)` }
                            : undefined
                        }
                      >
                        <span
                          className={cn(
                            'text-sm font-semibold tabular-nums',
                            count === 0 && 'text-muted-foreground/40',
                            count > 0 && op >= 50 && 'text-white drop-shadow-sm'
                          )}
                        >
                          {count === 0 ? '·' : count}
                        </span>
                      </td>
                    );
                  })}
                  <td
                    className="text-center px-3 py-2.5 align-middle border-l-2 border-border bg-muted/30 font-bold tabular-nums"
                    title={`${TEAM_SHORT_NAMES[team.team_id] ?? team.team_name} · ${total} ${meta.label.toLowerCase()}`}
                  >
                    {total}
                  </td>
                </tr>
              );
            })}
            {/* Bottom totals row — tier totals + grand total */}
            <tr className="border-t-2 border-border bg-muted/50 font-bold">
              <td className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                Tier Total
              </td>
              {TIERS.map((tier) => (
                <td
                  key={tier.id}
                  className="text-center px-2 py-2.5 tabular-nums border-l border-border/40"
                >
                  {colTotals.get(tier.id) ?? 0}
                </td>
              ))}
              <td className="text-center px-3 py-2.5 tabular-nums border-l-2 border-border bg-muted">
                {grandTotal}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
