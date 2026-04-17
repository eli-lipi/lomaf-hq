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

          {/* Single-column trade list */}
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
  coach: string;
  count: number;
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
    if (count > 0) rows.push({ coach: team.coach, count });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

function CoachActivity({ rows }: { rows: CoachActivityRow[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="bg-white border border-border rounded-lg p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        Trade Activity
      </h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.coach} className="grid grid-cols-[140px_1fr_auto] gap-3 items-center">
            <span className="text-sm font-medium truncate">{r.coach}</span>
            <div className="h-5 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-primary rounded transition-all"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
              {r.count} {r.count === 1 ? 'trade' : 'trades'}
            </span>
          </div>
        ))}
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
