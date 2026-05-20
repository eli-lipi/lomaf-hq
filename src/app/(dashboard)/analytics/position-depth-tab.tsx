'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, X, Sparkles, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { TEAM_COLOR_MAP, TEAM_SHORT_NAMES } from '@/lib/team-colors';
import { cn } from '@/lib/utils';
import {
  classifyPosition,
  normalizePosition,
  POSITION_COLOR,
  POSITION_LABEL_PLURAL,
  POSITION_HIERARCHY,
  type Position,
} from '@/lib/positions';

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

// Position colours mapped to a `bg` rgba for section card tinting.
// Single point of override for visualisation chrome; the canonical
// hex colour lives in `@/lib/positions`.
const POSITION_BG_TINT: Record<Position, string> = {
  FWD: 'rgba(220,38,38,0.06)',
  DEF: 'rgba(26,86,219,0.06)',
  RUC: 'rgba(124,58,237,0.06)',
  MID: 'rgba(5,150,105,0.06)',
};

// Section metadata — `noun` is interpolated into AI prompt context
// ('analyzing the forward line' vs 'analyzing the whole roster').
interface SectionMeta {
  label: string;
  color: string;
  bg: string;
  noun: string;
}

const POSITION_NOUN: Record<Position, string> = {
  FWD: 'forward line',
  DEF: 'defender line',
  RUC: 'ruck line',
  MID: 'midfield',
};

const POSITION_META: Record<Position, SectionMeta> = {
  FWD: { label: POSITION_LABEL_PLURAL.FWD, color: POSITION_COLOR.FWD, bg: POSITION_BG_TINT.FWD, noun: POSITION_NOUN.FWD },
  DEF: { label: POSITION_LABEL_PLURAL.DEF, color: POSITION_COLOR.DEF, bg: POSITION_BG_TINT.DEF, noun: POSITION_NOUN.DEF },
  RUC: { label: POSITION_LABEL_PLURAL.RUC, color: POSITION_COLOR.RUC, bg: POSITION_BG_TINT.RUC, noun: POSITION_NOUN.RUC },
  MID: { label: POSITION_LABEL_PLURAL.MID, color: POSITION_COLOR.MID, bg: POSITION_BG_TINT.MID, noun: POSITION_NOUN.MID },
};

const POSITION_ORDER = POSITION_HIERARCHY;

const SUMMARY_META: SectionMeta = {
  label: 'Roster Overview',
  color: '#1F2937',
  bg: 'rgba(31, 41, 55, 0.05)',
  noun: 'roster',
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

// A selection identifies a slice of one matrix. Selection state is
// lifted up to PositionDepthTab so only one section can be active at
// a time — clicking in Forwards clears anything that was active in
// Defenders (and the slide-over panel reflects the most recent click).
type Selection =
  | { kind: 'cell'; teamId: number; tier: TierId }
  | { kind: 'row'; teamId: number }
  | { kind: 'col'; tier: TierId }
  | { kind: 'all' };

interface ActiveSlice {
  sectionKey: string;
  selection: Selection;
  meta: SectionMeta;
  matrix: Map<string, RosterRow[]>;
  isSummary: boolean;
}

function selectionsEqual(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'cell' && b.kind === 'cell') return a.teamId === b.teamId && a.tier === b.tier;
  if (a.kind === 'row' && b.kind === 'row') return a.teamId === b.teamId;
  if (a.kind === 'col' && b.kind === 'col') return a.tier === b.tier;
  return a.kind === 'all' && b.kind === 'all';
}

// ────────────────────────────────────────────────────────────────────────────
// Tab root
// ────────────────────────────────────────────────────────────────────────────
export default function PositionDepthTab() {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestRound, setLatestRound] = useState<number>(0);
  const [sortMode, setSortMode] = useState<'depth' | 'team'>('depth');
  // Globally lifted selection — slide-over panel reads from this.
  const [activeSlice, setActiveSlice] = useState<ActiveSlice | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
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

      const rosters: { team_id: number; player_id: number; player_name: string }[] = [];
      let offset = 0;
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

      // Single source of truth as of v14: the `players` table, which
      // is refreshed every round via the mandatory Players CSV upload
      // (gated by verifyRoundReady before round-advance). One read
      // gives us both the canonical eligibility string and the
      // season-to-date average — no more amalgamating draft_picks,
      // observed lineup slots, and live point-rounds computation.
      //
      // If a player isn't in the players table (extremely rare —
      // would imply the CSV is missing them), we fall back to a
      // neutral 'MID' classification and 0 avg so they land in the
      // lowest tier without crashing.
      const playerDataById = new Map<number, { position: string | null; avg: number }>();
      let pOffset = 0;
      while (true) {
        const { data: batch } = await supabase
          .from('players')
          .select('player_id, position, avg_pts')
          .range(pOffset, pOffset + 999);
        if (!batch || batch.length === 0) break;
        for (const p of batch as Array<{ player_id: number | null; position: string | null; avg_pts: number | string | null }>) {
          if (p.player_id == null) continue;
          const avgRaw = p.avg_pts == null ? 0 : Number(p.avg_pts);
          playerDataById.set(p.player_id, {
            position: p.position,
            avg: Number.isFinite(avgRaw) ? avgRaw : 0,
          });
        }
        if (batch.length < 1000) break;
        pOffset += 1000;
      }

      const out: RosterRow[] = [];
      for (const r of rosters) {
        const pd = playerDataById.get(r.player_id);
        const rawPosition = normalizePosition(pd?.position) ?? 'MID';
        const avg = pd?.avg ?? 0;
        out.push({
          team_id: r.team_id,
          player_id: r.player_id,
          player_name: r.player_name,
          position: classifyPosition(rawPosition),
          rawPosition,
          // Keep one decimal of precision so a player like Nic Newman
          // averaging 89.7 displays as 89.7 — making it obvious he's
          // in the 80–89 tier, not the 90+ tier that 'round to 90'
          // would imply. Tier classification uses the raw (unrounded)
          // value below.
          avg: Math.round(avg * 10) / 10,
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

  const summaryMatrix = useMemo(() => {
    const m = new Map<string, RosterRow[]>();
    for (const r of rows) {
      const key = `${r.team_id}-${r.tier}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return m;
  }, [rows]);

  // Build a stable handler that takes section context + a selection
  // and either sets or clears the active slice. Called by each
  // matrix's click handlers via the SectionContainer wrapper.
  const handleSelect = (sectionKey: string, meta: SectionMeta, matrix: Map<string, RosterRow[]>, isSummary: boolean) => (next: Selection | null) => {
    if (next === null) {
      setActiveSlice(null);
      return;
    }
    setActiveSlice((current) => {
      if (current && current.sectionKey === sectionKey && selectionsEqual(current.selection, next)) {
        return null; // toggle off when re-clicking the same target
      }
      return { sectionKey, selection: next, meta, matrix, isSummary };
    });
  };

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

  const sections = [
    { key: 'position-depth-summary', meta: SUMMARY_META, matrix: summaryMatrix, isSummary: true },
    ...POSITION_ORDER.map((pos) => ({
      key: `position-depth-${pos.toLowerCase()}`,
      meta: POSITION_META[pos],
      matrix: matricesByPos[pos],
      isSummary: false,
    })),
  ];

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold mb-1">Position depth heat map</h2>
            <p className="text-xs text-muted-foreground max-w-3xl">
              How each coach&apos;s roster is distributed across season-average tiers, split by
              position. Players with dual eligibility resolve as <strong>Forward → Defender → Ruck → Mid</strong>{' '}
              (forwards / rucks are scarcer, so DPPs land in their scarcer slot). Click any cell,
              row total, column total, or grand total to open the player list in a side panel.
              Click a section title to collapse it. Darker cell = more players.
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

      {sections.map((s) => (
        <SectionContainer
          key={s.key}
          sectionKey={s.key}
          meta={s.meta}
          matrix={s.matrix}
          sortMode={sortMode}
          latestRound={latestRound}
          isSummary={s.isSummary}
          activeSelection={activeSlice?.sectionKey === s.key ? activeSlice.selection : null}
          onSelect={handleSelect(s.key, s.meta, s.matrix, s.isSummary)}
        />
      ))}

      <SlideOverPanel slice={activeSlice} onClose={() => setActiveSlice(null)} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SectionContainer — bundles the matrix + an AI insights card. Both
// are independent visual cards with their own padding/borders, so
// the insights aren't trapped against the bottom of the table.
// ────────────────────────────────────────────────────────────────────────────
function SectionContainer({
  sectionKey,
  meta,
  matrix,
  sortMode,
  latestRound,
  isSummary,
  activeSelection,
  onSelect,
}: {
  sectionKey: string;
  meta: SectionMeta;
  matrix: Map<string, RosterRow[]>;
  sortMode: 'depth' | 'team';
  latestRound: number;
  isSummary: boolean;
  activeSelection: Selection | null;
  onSelect: (selection: Selection | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <PositionMatrix
        meta={meta}
        matrix={matrix}
        sortMode={sortMode}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        activeSelection={activeSelection}
        onSelect={onSelect}
      />
      {!collapsed && latestRound > 0 && (
        <AIInsightsCard
          roundNumber={latestRound}
          sectionKey={sectionKey}
          sectionName={meta.label}
          matrix={matrix}
          meta={meta}
          isSummary={isSummary}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PositionMatrix — header + table only. Selection state is external,
// no inline breakdown (the slide-over panel handles that).
// ────────────────────────────────────────────────────────────────────────────
function PositionMatrix({
  meta,
  matrix,
  sortMode,
  collapsed,
  onToggleCollapse,
  activeSelection,
  onSelect,
}: {
  meta: SectionMeta;
  matrix: Map<string, RosterRow[]>;
  sortMode: 'depth' | 'team';
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeSelection: Selection | null;
  onSelect: (selection: Selection | null) => void;
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

  // Opacity scale:
  //   - Empty cells (count = 0) get a faint 4% tint so the grid feels
  //     cohesive (vs the section's colour floating on white).
  //   - Populated cells map count → [22%, 75%].
  const cellOpacityPercent = (count: number): number => {
    if (count === 0) return 4;
    if (maxCellCount === 0) return 4;
    return Math.round(22 + (count / Math.max(1, maxCellCount)) * 53);
  };

  // Toggle selection — clicking the same target clears it.
  const toggle = (next: Selection) => {
    if (activeSelection && selectionsEqual(activeSelection, next)) {
      onSelect(null);
    } else {
      onSelect(next);
    }
  };

  return (
    <section
      className="bg-card border border-border rounded-lg shadow-sm overflow-hidden"
      style={{ borderTop: `3px solid ${meta.color}` }}
    >
      {/* Header bundles chevron + label + player count on the left so
          all metadata reads as one block. Whole bar is clickable. */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className="w-full px-5 py-3 border-b border-border flex items-center gap-2 text-left hover:brightness-95 transition-all"
        style={{ background: meta.bg }}
      >
        {collapsed ? (
          <ChevronRight size={16} className="shrink-0" style={{ color: meta.color }} />
        ) : (
          <ChevronDown size={16} className="shrink-0" style={{ color: meta.color }} />
        )}
        <h3 className="text-base font-bold" style={{ color: meta.color }}>
          {meta.label}{' '}
          <span className="text-sm font-medium opacity-80">({grandTotal})</span>
        </h3>
      </button>
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="w-2.5 h-2.5 shrink-0" />
                    Coach
                  </span>
                </th>
                {TIERS.map((tier) => (
                  <th
                    key={tier.id}
                    className="text-center px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-l border-border/40 tabular-nums"
                  >
                    {tier.label}
                  </th>
                ))}
                <th className="text-center px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-foreground border-l-2 border-border bg-muted/70">
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
                      const count = matrix.get(key)?.length ?? 0;
                      const op = cellOpacityPercent(count);
                      const isSelected =
                        activeSelection?.kind === 'cell' &&
                        activeSelection.teamId === team.team_id &&
                        activeSelection.tier === tier.id;
                      const isClickable = count > 0;
                      return (
                        <td
                          key={tier.id}
                          onClick={isClickable ? () => toggle({ kind: 'cell', teamId: team.team_id, tier: tier.id }) : undefined}
                          className={cn(
                            'text-center px-2 py-2.5 align-middle border-l border-border/40 transition-all',
                            isClickable && 'cursor-pointer hover:brightness-110',
                            isSelected && 'ring-2 ring-offset-1 ring-foreground/70 relative z-10'
                          )}
                          style={{ background: `color-mix(in srgb, ${meta.color} ${op}%, transparent)` }}
                        >
                          <span
                            className={cn(
                              'text-sm font-bold tabular-nums',
                              count > 0 && op >= 45 && 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]'
                            )}
                          >
                            {count > 0 ? count : ''}
                          </span>
                        </td>
                      );
                    })}
                    <td
                      onClick={total > 0 ? () => toggle({ kind: 'row', teamId: team.team_id }) : undefined}
                      className={cn(
                        'text-center px-3 py-2.5 align-middle border-l-2 border-border bg-muted/70 font-bold tabular-nums transition-colors',
                        total > 0 && 'cursor-pointer hover:bg-muted',
                        activeSelection?.kind === 'row' && activeSelection.teamId === team.team_id && 'ring-2 ring-offset-1 ring-foreground/70 relative z-10'
                      )}
                    >
                      {total > 0 ? total : ''}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border bg-muted font-bold">
                <td className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="w-2.5 h-2.5 shrink-0" />
                    Tier Total
                  </span>
                </td>
                {TIERS.map((tier) => {
                  const tierTotal = colTotals.get(tier.id) ?? 0;
                  const isColSelected = activeSelection?.kind === 'col' && activeSelection.tier === tier.id;
                  return (
                    <td
                      key={tier.id}
                      onClick={tierTotal > 0 ? () => toggle({ kind: 'col', tier: tier.id }) : undefined}
                      className={cn(
                        'text-center px-2 py-2.5 tabular-nums border-l border-border/40 transition-colors',
                        tierTotal > 0 && 'cursor-pointer hover:bg-muted/60',
                        isColSelected && 'ring-2 ring-offset-1 ring-foreground/70 relative z-10'
                      )}
                    >
                      {tierTotal > 0 ? tierTotal : ''}
                    </td>
                  );
                })}
                <td
                  onClick={grandTotal > 0 ? () => toggle({ kind: 'all' }) : undefined}
                  className={cn(
                    'text-center px-3 py-2.5 tabular-nums border-l-2 border-border bg-slate-200 transition-colors',
                    grandTotal > 0 && 'cursor-pointer hover:bg-slate-300',
                    activeSelection?.kind === 'all' && 'ring-2 ring-offset-1 ring-foreground/70 relative z-10'
                  )}
                >
                  {grandTotal > 0 ? grandTotal : ''}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SlideOverPanel — right-anchored drawer. Renders globally, opens
// whenever there's an active slice. Player scores use neutral slate
// so they don't read as warnings; in the summary view a small
// position-colored dot leads each line so the position mix is still
// glanceable.
// ────────────────────────────────────────────────────────────────────────────
function SlideOverPanel({
  slice,
  onClose,
}: {
  slice: ActiveSlice | null;
  onClose: () => void;
}) {
  // Keep the most recently shown slice during close animation so the
  // panel content doesn't blink to empty before it slides out.
  const [displaySlice, setDisplaySlice] = useState<ActiveSlice | null>(slice);
  useEffect(() => {
    if (slice) {
      setDisplaySlice(slice);
    } else {
      const t = setTimeout(() => setDisplaySlice(null), 300);
      return () => clearTimeout(t);
    }
  }, [slice]);

  // Escape closes the panel.
  useEffect(() => {
    if (!slice) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [slice, onClose]);

  const players = useMemo(() => {
    if (!displaySlice) return [];
    const out: RosterRow[] = [];
    for (const team of TEAMS) {
      for (const tier of TIERS) {
        const inScope =
          displaySlice.selection.kind === 'all' ||
          (displaySlice.selection.kind === 'row' && displaySlice.selection.teamId === team.team_id) ||
          (displaySlice.selection.kind === 'col' && displaySlice.selection.tier === tier.id) ||
          (displaySlice.selection.kind === 'cell' && displaySlice.selection.teamId === team.team_id && displaySlice.selection.tier === tier.id);
        if (!inScope) continue;
        const key = `${team.team_id}-${tier.id}`;
        out.push(...(displaySlice.matrix.get(key) ?? []));
      }
    }
    return out.sort((a, b) => {
      if (b.avg !== a.avg) return b.avg - a.avg;
      return a.player_name.localeCompare(b.player_name);
    });
  }, [displaySlice]);

  const title = useMemo(() => {
    if (!displaySlice) return '';
    const s = displaySlice.selection;
    if (s.kind === 'all') return `All ${displaySlice.meta.label.toLowerCase()}`;
    if (s.kind === 'row') {
      const team = TEAMS.find((t) => t.team_id === s.teamId);
      return team?.team_name ?? '?';
    }
    if (s.kind === 'col') {
      const tier = TIERS.find((t) => t.id === s.tier);
      return `${displaySlice.meta.label} · ${tier?.label ?? '?'}`;
    }
    const team = TEAMS.find((t) => t.team_id === s.teamId);
    const tier = TIERS.find((t) => t.id === s.tier);
    return `${team?.team_name ?? '?'} · ${tier?.label ?? '?'}`;
  }, [displaySlice]);

  const subtitle = useMemo(() => {
    if (!displaySlice) return '';
    return `${displaySlice.meta.label} — ${players.length} player${players.length === 1 ? '' : 's'}`;
  }, [displaySlice, players.length]);

  const isOpen = slice !== null;
  const isSingleTeam =
    displaySlice?.selection.kind === 'cell' || displaySlice?.selection.kind === 'row';

  return (
    <div className={cn('fixed inset-0 z-50', !isOpen && 'pointer-events-none')}>
      {/* Backdrop — click to close */}
      <div
        className={cn(
          'absolute inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity duration-200',
          isOpen ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
      />
      {/* Panel — slides in from the right */}
      <div
        className={cn(
          'absolute right-0 top-0 bottom-0 w-full sm:w-[440px] bg-card shadow-2xl flex flex-col',
          'transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {displaySlice && (
          <>
            <header
              className="px-5 py-4 border-b border-border flex items-start justify-between gap-3"
              style={{ borderTop: `3px solid ${displaySlice.meta.color}` }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: displaySlice.meta.color }}>
                  {subtitle}
                </p>
                <h3 className="text-lg font-bold truncate mt-0.5">{title}</h3>
              </div>
              <button
                onClick={onClose}
                aria-label="Close panel"
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0 -mr-1 -mt-1 p-1"
              >
                <X size={18} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {players.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">No players in this slice.</p>
              ) : (
                <ul className="space-y-1.5">
                  {players.map((p) => {
                    const teamColor = TEAM_COLOR_MAP[p.team_id] ?? '#6B7280';
                    const isDpp = /[/,]|\s/.test(p.rawPosition.trim());
                    return (
                      <li
                        key={`${p.team_id}-${p.player_id}`}
                        className="flex items-center gap-2.5 text-sm leading-snug min-w-0 py-1 border-b border-border/30 last:border-b-0"
                      >
                        {/* Position-color dot leads the line in the
                            Roster Overview so the position mix is
                            visible at a glance. Hidden for per-
                            position views where it's redundant. */}
                        {displaySlice.isSummary && (
                          <span
                            aria-hidden
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: POSITION_META[p.position].color }}
                            title={p.position}
                          />
                        )}
                        {/* Avg score — neutral dark slate, NOT
                            position-coloured. Coloured numbers were
                            reading as warning flags. One decimal so
                            the tier boundary is unambiguous (89.7 vs
                            90.0). Wider box (w-11) to fit '100.5'. */}
                        <span className="text-sm font-bold tabular-nums shrink-0 w-11 text-right text-slate-800">
                          {p.avg.toFixed(1)}
                        </span>
                        {/* Team marker — only for multi-team selections. */}
                        {!isSingleTeam && (
                          <>
                            <span
                              aria-hidden
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ background: teamColor }}
                            />
                            <span
                              className="text-[10px] font-semibold uppercase tracking-wider shrink-0 w-10 truncate"
                              style={{ color: teamColor }}
                            >
                              {TEAM_SHORT_NAMES[p.team_id] ?? ''}
                            </span>
                          </>
                        )}
                        <span className="truncate min-w-0 flex-1 text-foreground">
                          {p.player_name}
                        </span>
                        {isDpp && (
                          <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded bg-muted text-muted-foreground shrink-0">
                            {p.rawPosition}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AIInsightsCard — fetches AI-generated trade-focused insights via
// /api/ai/chart-insights. Caches per round + section_key. Renders
// outside the matrix table so it sits as its own breathing summary
// card (per the user's UX feedback).
// ────────────────────────────────────────────────────────────────────────────
function AIInsightsCard({
  roundNumber,
  sectionKey,
  sectionName,
  matrix,
  meta,
  isSummary,
}: {
  roundNumber: number;
  sectionKey: string;
  sectionName: string;
  matrix: Map<string, RosterRow[]>;
  meta: SectionMeta;
  isSummary: boolean;
}) {
  const [insights, setInsights] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load cached insights on mount — same pattern as InsightsPanel.
  useEffect(() => {
    let cancelled = false;
    async function loadCached() {
      try {
        const res = await fetch(`/api/ai/chart-insights?round=${roundNumber}&section=${sectionKey}`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data.insights)) {
          setInsights(data.insights);
        }
      } catch {
        /* ignore */
      }
    }
    if (roundNumber) loadCached();
    return () => {
      cancelled = true;
    };
  }, [roundNumber, sectionKey]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const sectionData = buildSectionData(matrix, meta, isSummary);
      const res = await fetch('/api/ai/chart-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundNumber, sectionKey, sectionName: `${sectionName} (Position Depth)`, sectionData }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate insights');
      }
      const data = await res.json();
      setInsights(data.insights);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p
          className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5"
          style={{ color: meta.color }}
        >
          <Sparkles size={12} className="text-amber-500" />
          {meta.label} — Trade Insights
        </p>
        {(insights || error) && (
          <button
            onClick={generate}
            disabled={loading}
            className={cn(
              'flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors',
              loading && 'opacity-50 cursor-not-allowed'
            )}
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Generating…' : 'Regenerate'}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {!insights && !loading && !error && (
        <button
          onClick={generate}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors font-medium"
        >
          <Sparkles size={14} />
          Generate trade-focused insights
        </button>
      )}

      {loading && !insights && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Analyzing roster patterns…
        </div>
      )}

      {insights && insights.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          {insights.map((insight, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground leading-relaxed">
              <span aria-hidden className="shrink-0 text-base leading-none mt-0.5">
                💡
              </span>
              <span className="min-w-0">{insight}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Build the JSON payload sent to the AI. Includes an explicit
 * INSTRUCTIONS field at the top so the model focuses on trade-actionable
 * patterns rather than generic stats commentary. The system prompt is
 * already configured for punchy LOMAF takes; this just steers it
 * toward 'who could trade what' framing.
 */
function buildSectionData(matrix: Map<string, RosterRow[]>, meta: SectionMeta, isSummary: boolean) {
  const tierMap: Record<TierId, string> = {
    '100+': '100+',
    '90s': '90-99',
    '80s': '80-89',
    '70s': '70-79',
    '<70': '<70',
  };

  const perTeam: Record<string, Record<string, number>> = {};
  let leagueTotal = 0;
  let leaguePremium = 0;
  for (const team of TEAMS) {
    const data: Record<string, number> = {};
    let teamTotal = 0;
    for (const tier of TIERS) {
      const count = matrix.get(`${team.team_id}-${tier.id}`)?.length ?? 0;
      data[tierMap[tier.id]] = count;
      teamTotal += count;
      if (tier.id === '100+') leaguePremium += count;
    }
    data.total = teamTotal;
    perTeam[team.team_name] = data;
    leagueTotal += teamTotal;
  }

  // Top 10 players in this section (across all teams + tiers) —
  // gives the AI concrete names to reference in its insights.
  const allPlayers: { name: string; team: string; avg: number; eligibility: string }[] = [];
  for (const team of TEAMS) {
    for (const tier of TIERS) {
      const list = matrix.get(`${team.team_id}-${tier.id}`) ?? [];
      for (const p of list) {
        allPlayers.push({
          name: p.player_name,
          team: team.team_name,
          avg: p.avg,
          eligibility: p.rawPosition,
        });
      }
    }
  }
  const topPlayers = allPlayers.sort((a, b) => b.avg - a.avg).slice(0, 10);

  return {
    INSTRUCTIONS: `Provide 2-3 TRADE-FOCUSED insights for LOMAF coaches looking at this ${isSummary ? 'overall roster depth' : meta.label.toLowerCase() + ' depth'} view. Each insight MUST identify a specific trade opportunity: a coach who has surplus depth they could trade away, a coach who has a positional weakness they need to address, or a cross-position arbitrage opportunity between coaches. Be specific — name the coach (use their team name), the position involved, and the rationale. Example output: "Mansion Mambas has 4 forwards averaging over 80, whereas most teams only have 2 — he could consider trading one to bolster his midfield." Avoid generic observations like 'X has the deepest line' without naming a trade angle.`,
    view: isSummary ? 'Roster overview (all positions aggregated)' : `Position depth: ${meta.label} only`,
    tier_buckets: 'Players grouped by season-to-date average: 100+, 90-99, 80-89, 70-79, <70',
    per_team_counts: perTeam,
    league_total: leagueTotal,
    league_premium_count: leaguePremium,
    top_players_in_section: topPlayers,
  };
}
