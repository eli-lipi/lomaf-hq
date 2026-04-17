'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, ArrowLeftRight } from 'lucide-react';
import TradeCard from './trade-card';
import TradeDetail from './trade-detail';
import LogTradeModal from './log-trade-modal';
import { TEAMS } from '@/lib/constants';
import type { Trade, TradePlayer, TradeProbability } from '@/lib/trades/types';

interface ListItem {
  trade: Trade;
  players: (TradePlayer & { draft_position?: string | null; injured?: boolean })[];
  latestProbability: TradeProbability | null;
  probabilityHistory: TradeProbability[];
}

type SortKey = 'recent' | 'largest' | 'oldest';

export default function TradeTrackingTab() {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('recent');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/trades/list');
    if (res.ok) {
      const json = await res.json();
      setItems(json.trades ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => computeSummary(items), [items]);
  const activity = useMemo(() => computeCoachActivity(items), [items]);

  const sortedItems = useMemo(() => {
    const arr = [...items];
    if (sort === 'recent') {
      arr.sort((a, b) => {
        if (b.trade.round_executed !== a.trade.round_executed) {
          return b.trade.round_executed - a.trade.round_executed;
        }
        return new Date(b.trade.created_at).getTime() - new Date(a.trade.created_at).getTime();
      });
    } else if (sort === 'oldest') {
      arr.sort((a, b) => {
        if (a.trade.round_executed !== b.trade.round_executed) {
          return a.trade.round_executed - b.trade.round_executed;
        }
        return new Date(a.trade.created_at).getTime() - new Date(b.trade.created_at).getTime();
      });
    } else if (sort === 'largest') {
      arr.sort((a, b) => b.players.length - a.players.length);
    }
    return arr;
  }, [items, sort]);

  if (activeTradeId) {
    return (
      <TradeDetail
        tradeId={activeTradeId}
        onBack={() => {
          setActiveTradeId(null);
          load();
        }}
        onDeleted={() => {
          setActiveTradeId(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Log Trade action */}
      <div className="flex justify-end">
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          <Plus size={16} /> Log Trade
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading trades...</div>
      ) : items.length === 0 ? (
        <EmptyState onLog={() => setModalOpen(true)} />
      ) : (
        <>
          {/* Row 1: key numbers */}
          <SummaryStats summary={summary} />

          {/* Row 2: trade activity by coach */}
          {activity.length > 0 && <CoachActivity rows={activity} />}

          {/* Sort pills */}
          <div className="flex items-center gap-2">
            <SortPill label="Most Recent" active={sort === 'recent'} onClick={() => setSort('recent')} />
            <SortPill label="Largest" active={sort === 'largest'} onClick={() => setSort('largest')} />
            <SortPill label="Oldest" active={sort === 'oldest'} onClick={() => setSort('oldest')} />
          </div>

          {/* Trade list — grouped by round under section headers for chronological
              sorts, flat list for 'Largest' (where round grouping would be noise). */}
          {sort === 'largest' ? (
            <div className="flex flex-col gap-4">
              {sortedItems.map((item) => (
                <TradeCard
                  key={item.trade.id}
                  trade={item.trade}
                  players={item.players}
                  onViewDetails={() => setActiveTradeId(item.trade.id)}
                />
              ))}
            </div>
          ) : (
            <GroupedByRound
              items={sortedItems}
              onOpen={(id) => setActiveTradeId(id)}
            />
          )}
        </>
      )}

      {modalOpen && (
        <LogTradeModal
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Grouped-by-round list
// ============================================================

function GroupedByRound({
  items,
  onOpen,
}: {
  items: ListItem[];
  onOpen: (tradeId: string) => void;
}) {
  // Bucket into Map<round, ListItem[]> preserving incoming order so the sort
  // direction (recent/oldest) naturally controls the order of round groups.
  const groups = new Map<number, ListItem[]>();
  for (const it of items) {
    const r = it.trade.round_executed;
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(it);
  }

  return (
    <div className="flex flex-col gap-2">
      {Array.from(groups.entries()).map(([round, groupItems], idx) => (
        <div key={round} className={idx === 0 ? 'space-y-4' : 'space-y-4 pt-6'}>
          <RoundHeader round={round} />
          <div className="flex flex-col gap-4">
            {groupItems.map((item) => (
              <TradeCard
                key={item.trade.id}
                trade={item.trade}
                players={item.players}
                onViewDetails={() => onOpen(item.trade.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RoundHeader({ round }: { round: number }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px bg-border flex-1" />
      <span
        className="text-sm font-bold uppercase text-muted-foreground"
        style={{ letterSpacing: '0.15em' }}
      >
        Round {round}
      </span>
      <div className="h-px bg-border flex-1" />
    </div>
  );
}

// ============================================================
// Empty state
// ============================================================

function EmptyState({ onLog }: { onLog: () => void }) {
  return (
    <div className="bg-white border border-border rounded-lg p-10 text-center">
      <div className="w-12 h-12 mx-auto rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
        <ArrowLeftRight size={20} />
      </div>
      <h3 className="text-base font-semibold">No trades logged yet</h3>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Log a trade and we&apos;ll start tracking the win probability over time.
      </p>
      <button
        onClick={onLog}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90"
      >
        <Plus size={16} /> Log your first trade
      </button>
    </div>
  );
}

// ============================================================
// Row 1: Summary stats (# Trades, # Players, Trades/Coach, Avg Size)
// ============================================================

interface Summary {
  totalTrades: number;
  totalPlayers: number;           // total rows in trade_players — every player's move counted
  tradesPerCoach: number;          // totalTrades / 10 coaches
  avgTradeSize: number;            // avg players per trade (both sides combined)
}

function computeSummary(items: ListItem[]): Summary {
  if (items.length === 0) {
    return { totalTrades: 0, totalPlayers: 0, tradesPerCoach: 0, avgTradeSize: 0 };
  }
  const totalTrades = items.length;
  const totalPlayers = items.reduce((sum, it) => sum + it.players.length, 0);
  const tradesPerCoach = totalTrades / TEAMS.length;
  const avgTradeSize = totalPlayers / totalTrades;
  return { totalTrades, totalPlayers, tradesPerCoach, avgTradeSize };
}

function SummaryStats({ summary }: { summary: Summary }) {
  const cards = [
    { label: '# Trades', value: String(summary.totalTrades) },
    { label: '# Players Traded', value: String(summary.totalPlayers) },
    { label: 'Trades per Coach', value: summary.tradesPerCoach.toFixed(1) },
    { label: 'Avg Trade Size', value: `${summary.avgTradeSize.toFixed(1)} players` },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white border border-border rounded-lg px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {c.label}
          </p>
          <p className="text-xl font-bold mt-1 tabular-nums">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Row 2: Trade activity by coach
// ============================================================

interface CoachActivityRow {
  teamId: number;
  teamName: string;
  shortName: string;
  count: number;
}

/** Short team label for crowded x-axis tick labels. */
function shortTeamName(fullName: string): string {
  const map: Record<string, string> = {
    'Mansion Mambas': 'Mansion',
    'South Tel Aviv Dragons': 'Dragons',
    'I believe in SEANO': 'SEANO',
    "Littl' bit LIPI": 'LIPI',
    'Melech Mitchito': 'Melech',
    "Cripps Don't Lie": 'Cripps',
    'Take Me Home Country Road': 'Country Rd',
    'Doge Bombers': 'Doge',
    'Gun M Down': 'Gun M',
    'Warnered613': 'Warnered',
  };
  return map[fullName] ?? fullName.split(/\s+/)[0];
}

function computeCoachActivity(items: ListItem[]): CoachActivityRow[] {
  const countByTeamId = new Map<number, number>();
  for (const it of items) {
    countByTeamId.set(it.trade.team_a_id, (countByTeamId.get(it.trade.team_a_id) ?? 0) + 1);
    countByTeamId.set(it.trade.team_b_id, (countByTeamId.get(it.trade.team_b_id) ?? 0) + 1);
  }
  const rows: CoachActivityRow[] = [];
  for (const team of TEAMS) {
    const count = countByTeamId.get(team.team_id) ?? 0;
    if (count > 0) {
      rows.push({
        teamId: team.team_id,
        teamName: team.team_name,
        shortName: shortTeamName(team.team_name),
        count,
      });
    }
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

function CoachActivity({ rows }: { rows: CoachActivityRow[] }) {
  // Integer-scaled y-axis (0, 1, 2, 3...). Pad at least +1 above the tallest bar
  // so the count label has breathing room above the bar.
  const maxCount = Math.max(...rows.map((r) => r.count), 1);
  const yMax = maxCount + 1;
  const yTicks = Array.from({ length: yMax + 1 }, (_, i) => i);

  // Bar chart dimensions
  const chartHeight = 180; // px

  return (
    <div className="bg-white border border-border rounded-lg p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        Trade Activity
      </h3>

      <div className="flex gap-3">
        {/* Y-axis tick labels */}
        <div
          className="flex flex-col-reverse justify-between text-[10px] text-muted-foreground tabular-nums pr-1"
          style={{ height: chartHeight }}
        >
          {yTicks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>

        {/* Bars */}
        <div
          className="flex-1 grid gap-2 items-end border-l border-b border-border"
          style={{
            gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`,
            height: chartHeight,
          }}
        >
          {rows.map((r) => {
            const barPct = (r.count / yMax) * 100;
            return (
              <div key={r.teamId} className="relative h-full flex flex-col justify-end items-center">
                {/* Count label above bar */}
                <span className="text-[11px] font-semibold tabular-nums mb-1">{r.count}</span>
                <div
                  className="w-full max-w-[48px] bg-primary rounded-t transition-all hover:opacity-90"
                  style={{ height: `${barPct}%` }}
                  title={`${r.teamName}: ${r.count} ${r.count === 1 ? 'trade' : 'trades'}`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* X-axis team name labels — aligned with bars above */}
      <div className="flex gap-3 mt-1">
        <div className="w-4" /> {/* spacer to align with y-axis column */}
        <div
          className="flex-1 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
        >
          {rows.map((r) => (
            <span
              key={r.teamId}
              className="text-[11px] text-muted-foreground text-center truncate"
              title={r.teamName}
            >
              {r.shortName}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Sort pills
// ============================================================

function SortPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-white text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}
