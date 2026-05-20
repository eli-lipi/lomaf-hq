'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
// in their scarcer slot (forwards / rucks are scarce).
type Position = 'FWD' | 'DEF' | 'RUC' | 'MID';
const POSITION_ORDER: Position[] = ['FWD', 'DEF', 'RUC', 'MID'];
const ALL_POSITIONS = new Set<Position>(['DEF', 'MID', 'RUC', 'FWD']);
// AFL Fantasy display convention — list in DEF, MID, RUC, FWD order
// so DPPs render as "MID/FWD", "DEF/MID", etc. (not "FWD/MID").
const POSITION_DISPLAY_ORDER: Position[] = ['DEF', 'MID', 'RUC', 'FWD'];

function classifyPosition(raw: string): Position {
  const parts = raw.toUpperCase().split(/[\s/,|]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.startsWith('FWD') || p.startsWith('FOR'))) return 'FWD';
  if (parts.some((p) => p.startsWith('DEF') || p.startsWith('BAC'))) return 'DEF';
  if (parts.some((p) => p.startsWith('RUC') || p.startsWith('RUK'))) return 'RUC';
  return 'MID';
}

/**
 * Build a canonical eligibility string from any combination of inputs:
 *   - The draft-pick position (pre-season eligibility, may be stale)
 *   - Lineup slots the player has actually been played in this season
 *     (catches mid-season position grants — e.g. a MID-only draftee
 *     who gained FWD eligibility after a few games up front)
 *
 * Returns a slash-joined string in DEF/MID/RUC/FWD order, e.g.
 *   "MID/FWD", "DEF/MID/FWD", "RUC", "DEF/FWD". Empty input → "MID".
 */
function deriveEligibility(draftRaw: string, observedSlots: Set<string>): string {
  const found = new Set<Position>();
  for (const raw of draftRaw.toUpperCase().split(/[\s/,|]+/)) {
    const t = raw.trim();
    if ((ALL_POSITIONS as Set<string>).has(t)) found.add(t as Position);
  }
  for (const slot of observedSlots) {
    const t = slot.trim().toUpperCase();
    if ((ALL_POSITIONS as Set<string>).has(t)) found.add(t as Position);
  }
  if (found.size === 0) return 'MID';
  return POSITION_DISPLAY_ORDER.filter((p) => found.has(p)).join('/');
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

      // 3. Position lookup — draft_picks is the pre-season source. We
      //    keep the first non-empty entry per player_id (dupes happen
      //    when a player gets traded mid-season). The draft positions
      //    can be STALE — players gain DPP eligibility through the
      //    season and the draft CSV doesn't reflect that — so step 4
      //    augments these with actually-observed lineup slots.
      const { data: draftPicks } = await supabase
        .from('draft_picks')
        .select('player_id, position');
      const posByPlayer = new Map<number, string>();
      for (const dp of draftPicks ?? []) {
        if (dp.position && !posByPlayer.has(dp.player_id)) {
          posByPlayer.set(dp.player_id, dp.position);
        }
      }

      // 4. Lineup-slot history across ALL rounds — every position
      //    slot a player has been played in this season reveals an
      //    eligibility. Catches mid-season DPP grants (e.g. Chad
      //    Warner gaining FWD after the draft). UTL/BN/EMG are
      //    position-agnostic slots so we ignore them; only DEF/MID/
      //    RUC/FWD slot strings reveal real eligibility.
      const slotsByPlayer = new Map<number, Set<string>>();
      let slotOffset = 0;
      while (true) {
        const { data: batch } = await supabase
          .from('player_rounds')
          .select('player_id, pos')
          .range(slotOffset, slotOffset + 999);
        if (!batch || batch.length === 0) break;
        for (const r of batch) {
          if (!r.pos || r.player_id == null) continue;
          const p = String(r.pos).toUpperCase().trim();
          if (!ALL_POSITIONS.has(p as Position)) continue;
          if (!slotsByPlayer.has(r.player_id)) slotsByPlayer.set(r.player_id, new Set());
          slotsByPlayer.get(r.player_id)!.add(p);
        }
        if (batch.length < 1000) break;
        slotOffset += 1000;
      }

      // 5. Season averages — `players.avg_pts` is the league-canonical
      //    season-to-date average (same field byes/injuries use).
      const { data: playersData } = await supabase
        .from('players')
        .select('player_id, avg_pts');
      const avgByPlayer = new Map<number, number>();
      for (const p of playersData ?? []) {
        if (p.avg_pts != null) avgByPlayer.set(p.player_id, p.avg_pts);
      }

      // 6. Assemble.
      const out: RosterRow[] = [];
      for (const r of rosters) {
        const draftRaw = posByPlayer.get(r.player_id) ?? '';
        const observedSlots = slotsByPlayer.get(r.player_id) ?? new Set<string>();
        const rawPosition = deriveEligibility(draftRaw, observedSlots);
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
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Intro panel — explains the lens and the sort toggle. */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold mb-1">Position depth heat map</h2>
            <p className="text-xs text-muted-foreground max-w-3xl">
              How each coach&apos;s roster is distributed across season-average tiers, split by
              position. Players with dual eligibility resolve as <strong>Forward → Defender → Ruck → Mid</strong>{' '}
              (forwards / rucks are scarcer, so DPPs land in their scarcer slot). Click any cell,
              row total, column total, or grand total to see the players underneath. Click a
              section title to collapse it. Darker cell = more players.
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
// A 'selection' is what the user clicked. Cells, row totals, column
// totals, and the grand total are all selectable — each maps to a
// different slice of the position's players that we render in the
// breakdown panel below the table.
type Selection =
  | { kind: 'cell'; teamId: number; tier: TierId }
  | { kind: 'row'; teamId: number }
  | { kind: 'col'; tier: TierId }
  | { kind: 'all' }
  | null;

function selectionsEqual(a: NonNullable<Selection>, b: NonNullable<Selection>): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'cell' && b.kind === 'cell') return a.teamId === b.teamId && a.tier === b.tier;
  if (a.kind === 'row' && b.kind === 'row') return a.teamId === b.teamId;
  if (a.kind === 'col' && b.kind === 'col') return a.tier === b.tier;
  return a.kind === 'all' && b.kind === 'all';
}

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
  // Selection state is local to each matrix so clicking around in
  // Forwards doesn't reset the user's exploration in Defenders.
  const [selection, setSelection] = useState<Selection>(null);
  const [collapsed, setCollapsed] = useState(false);

  const toggleSelection = (next: NonNullable<Selection>) => {
    setSelection((current) => {
      if (current && selectionsEqual(current, next)) return null;
      return next;
    });
  };

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

  // Opacity scale:
  //   - Empty cells (count = 0) get a faint 4% tint so the grid feels
  //     cohesive (vs the section's color floating on white).
  //   - Populated cells map count → [22%, 75%]. Min floor ensures even
  //     a single player is visually distinct from empty.
  const cellOpacityPercent = (count: number): number => {
    if (count === 0) return 4;
    if (maxCellCount === 0) return 4;
    return Math.round(22 + (count / Math.max(1, maxCellCount)) * 53);
  };

  return (
    <section
      className="bg-card border border-border rounded-lg shadow-sm overflow-hidden"
      style={{ borderTop: `3px solid ${meta.color}` }}
    >
      {/* Header doubles as the collapse trigger — whole bar is
          clickable so the affordance is obvious without needing the
          chevron to be the only target. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full px-5 py-3 border-b border-border flex items-baseline justify-between flex-wrap gap-2 text-left hover:brightness-95 transition-all"
        style={{ background: meta.bg }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {collapsed ? (
            <ChevronRight size={16} className="shrink-0" style={{ color: meta.color }} />
          ) : (
            <ChevronDown size={16} className="shrink-0" style={{ color: meta.color }} />
          )}
          <h3 className="text-base font-bold" style={{ color: meta.color }}>
            {meta.label}
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {grandTotal} player{grandTotal === 1 ? '' : 's'} across the league
        </p>
      </button>
      {!collapsed && (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {/* Coach header indented by an invisible dot-width spacer
                  so the word 'Coach' lines up with the team-name text
                  in the rows below (which sit after the color dot). */}
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
                    const players = matrix.get(key) ?? [];
                    const count = players.length;
                    const op = cellOpacityPercent(count);
                    const isSelected =
                      selection?.kind === 'cell' &&
                      selection.teamId === team.team_id &&
                      selection.tier === tier.id;
                    const isInSelectedRow =
                      selection?.kind === 'row' && selection.teamId === team.team_id;
                    const isInSelectedCol =
                      selection?.kind === 'col' && selection.tier === tier.id;
                    const isClickable = count > 0;
                    return (
                      <td
                        key={tier.id}
                        onClick={isClickable ? () => toggleSelection({ kind: 'cell', teamId: team.team_id, tier: tier.id }) : undefined}
                        className={cn(
                          'text-center px-2 py-2.5 align-middle border-l border-border/40 transition-all',
                          isClickable && 'cursor-pointer hover:brightness-110',
                          isSelected && 'ring-2 ring-offset-1 ring-foreground/60 relative z-10',
                          (isInSelectedRow || isInSelectedCol) && !isSelected && 'outline outline-1 outline-foreground/30'
                        )}
                        style={{ background: `color-mix(in srgb, ${meta.color} ${op}%, transparent)` }}
                      >
                        <span
                          className={cn(
                            'text-sm font-bold tabular-nums',
                            // Flip to white text + heavier shadow once
                            // the cell tint passes ~45% — keeps the
                            // count legible against the saturated end
                            // of the scale (was 50, dropped so dark
                            // cells are readable).
                            count > 0 && op >= 45 && 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]'
                          )}
                        >
                          {/* Blank cell when count = 0 — the faint
                              4% tint is enough to anchor the grid
                              structure without needing a placeholder
                              glyph. */}
                          {count > 0 ? count : ''}
                        </span>
                      </td>
                    );
                  })}
                  <td
                    onClick={total > 0 ? () => toggleSelection({ kind: 'row', teamId: team.team_id }) : undefined}
                    className={cn(
                      'text-center px-3 py-2.5 align-middle border-l-2 border-border bg-muted/70 font-bold tabular-nums transition-colors',
                      total > 0 && 'cursor-pointer hover:bg-muted',
                      selection?.kind === 'row' && selection.teamId === team.team_id && 'ring-2 ring-offset-1 ring-foreground/60 relative z-10'
                    )}
                  >
                    {total > 0 ? total : ''}
                  </td>
                </tr>
              );
            })}
            {/* Bottom totals row — tier totals + grand total. Stronger
                background tint + heavier top border so the summary
                row reads as a distinct band, not just another data row. */}
            <tr className="border-t-2 border-border bg-muted font-bold">
              <td className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-foreground">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="w-2.5 h-2.5 shrink-0" />
                  Tier Total
                </span>
              </td>
              {TIERS.map((tier) => {
                const tierTotal = colTotals.get(tier.id) ?? 0;
                const isColSelected = selection?.kind === 'col' && selection.tier === tier.id;
                return (
                  <td
                    key={tier.id}
                    onClick={tierTotal > 0 ? () => toggleSelection({ kind: 'col', tier: tier.id }) : undefined}
                    className={cn(
                      'text-center px-2 py-2.5 tabular-nums border-l border-border/40 transition-colors',
                      tierTotal > 0 && 'cursor-pointer hover:bg-muted/60',
                      isColSelected && 'ring-2 ring-offset-1 ring-foreground/60 relative z-10'
                    )}
                  >
                    {tierTotal > 0 ? tierTotal : ''}
                  </td>
                );
              })}
              {/* Grand total cell — strongest neutral so the corner
                  reads as the apex of both summary axes. */}
              <td
                onClick={grandTotal > 0 ? () => toggleSelection({ kind: 'all' }) : undefined}
                className={cn(
                  'text-center px-3 py-2.5 tabular-nums border-l-2 border-border bg-slate-200 transition-colors',
                  grandTotal > 0 && 'cursor-pointer hover:bg-slate-300',
                  selection?.kind === 'all' && 'ring-2 ring-offset-1 ring-foreground/60 relative z-10'
                )}
              >
                {grandTotal > 0 ? grandTotal : ''}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      )}
      {/* Breakdown panel — visible when something is selected and the
          section is expanded. Lives inside the section card so the
          matrix and its drill-down stay visually attached. */}
      {!collapsed && selection && (
        <BreakdownPanel
          selection={selection}
          matrix={matrix}
          meta={meta}
          onClose={() => setSelection(null)}
        />
      )}
    </section>
  );
}

// ─── Breakdown panel ────────────────────────────────────────────────────────
function BreakdownPanel({
  selection,
  matrix,
  meta,
  onClose,
}: {
  selection: NonNullable<Selection>;
  matrix: Map<string, RosterRow[]>;
  meta: (typeof POSITION_META)[Position];
  onClose: () => void;
}) {
  // Resolve which (team, tier) pairs are in scope, then flatten to a
  // sorted list of player rows.
  const players = useMemo(() => {
    const out: RosterRow[] = [];
    for (const team of TEAMS) {
      for (const tier of TIERS) {
        const inScope =
          selection.kind === 'all' ||
          (selection.kind === 'row' && selection.teamId === team.team_id) ||
          (selection.kind === 'col' && selection.tier === tier.id) ||
          (selection.kind === 'cell' && selection.teamId === team.team_id && selection.tier === tier.id);
        if (!inScope) continue;
        const key = `${team.team_id}-${tier.id}`;
        out.push(...(matrix.get(key) ?? []));
      }
    }
    return out.sort((a, b) => {
      // Highest average first across the whole list.
      if (b.avg !== a.avg) return b.avg - a.avg;
      return a.player_name.localeCompare(b.player_name);
    });
  }, [selection, matrix]);

  // Build the human title from the selection shape.
  const title = useMemo(() => {
    if (selection.kind === 'all') return `All ${meta.label.toLowerCase()} (${players.length})`;
    if (selection.kind === 'row') {
      const team = TEAMS.find((t) => t.team_id === selection.teamId);
      return `${team?.team_name ?? '?'} — ${meta.label.toLowerCase()} (${players.length})`;
    }
    if (selection.kind === 'col') {
      const tier = TIERS.find((t) => t.id === selection.tier);
      return `${meta.label} in ${tier?.label ?? '?'} (${players.length})`;
    }
    const team = TEAMS.find((t) => t.team_id === selection.teamId);
    const tier = TIERS.find((t) => t.id === selection.tier);
    return `${team?.team_name ?? '?'} — ${meta.label.toLowerCase()} ${tier?.label ?? '?'} (${players.length})`;
  }, [selection, meta.label, players.length]);

  return (
    <div className="border-t border-border bg-muted/10">
      <div className="px-5 py-3 flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: meta.color }}>
          {title}
        </p>
        <button
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear selection ✕
        </button>
      </div>
      {players.length === 0 ? (
        <p className="px-5 pb-4 text-xs italic text-muted-foreground">No players in this slice.</p>
      ) : (
        <ul className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
          {players.map((p) => {
            const teamColor = TEAM_COLOR_MAP[p.team_id] ?? '#6B7280';
            // DPP tag — only show if the player's raw eligibility
            // mentions more than one position, so the user can spot
            // who's flexible vs. who's locked in.
            const isDpp = /[/,]|\s/.test(p.rawPosition.trim());
            return (
              <li key={`${p.team_id}-${p.player_id}`} className="flex items-center gap-2 text-xs leading-snug min-w-0">
                <span
                  aria-hidden
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: teamColor }}
                  title={TEAM_SHORT_NAMES[p.team_id] ?? ''}
                />
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider shrink-0 w-12 truncate"
                  style={{ color: teamColor }}
                >
                  {TEAM_SHORT_NAMES[p.team_id] ?? ''}
                </span>
                <span className="truncate flex-1 text-foreground">{p.player_name}</span>
                {isDpp && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded bg-muted text-muted-foreground shrink-0">
                    {p.rawPosition}
                  </span>
                )}
                <span className="text-xs font-bold tabular-nums shrink-0 w-8 text-right" style={{ color: meta.color }}>
                  {p.avg}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
