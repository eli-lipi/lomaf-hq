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
  players: TradePlayer[];
  latestProbability: TradeProbability | null;
  probabilityHistory: TradeProbability[];
}

export default function TradeTrackingTab() {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);

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
      {/* Summary + action bar */}
      <div className="flex items-start justify-between gap-4">
        <SummaryBar summary={summary} />
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 shrink-0"
        >
          <Plus size={16} /> Log Trade
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading trades...</div>
      ) : items.length === 0 ? (
        <EmptyState onLog={() => setModalOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((item) => (
            <TradeCard
              key={item.trade.id}
              trade={item.trade}
              players={item.players}
              latestProbability={item.latestProbability}
              onViewDetails={() => setActiveTradeId(item.trade.id)}
            />
          ))}
        </div>
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

function EmptyState({ onLog }: { onLog: () => void }) {
  return (
    <div className="bg-white border border-border rounded-lg p-10 text-center">
      <div className="w-12 h-12 mx-auto rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
        <ArrowLeftRight size={20} />
      </div>
      <h3 className="text-base font-semibold">No trades logged yet</h3>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Upload a trade screenshot and we&apos;ll start tracking the win probability over time.
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
// Summary stats
// ============================================================

interface Summary {
  total: number;
  mostActive: { coach: string; count: number } | null;
  bestTrade: { teamName: string; prob: number; id: string } | null;
  worstTrade: { teamName: string; prob: number; id: string } | null;
  mostVolatile: { id: string; range: number } | null;
}

function computeSummary(items: ListItem[]): Summary {
  if (items.length === 0) {
    return { total: 0, mostActive: null, bestTrade: null, worstTrade: null, mostVolatile: null };
  }

  // Most active trader — count appearances in trades per coach
  const teamCounts = new Map<number, number>();
  for (const it of items) {
    teamCounts.set(it.trade.team_a_id, (teamCounts.get(it.trade.team_a_id) ?? 0) + 1);
    teamCounts.set(it.trade.team_b_id, (teamCounts.get(it.trade.team_b_id) ?? 0) + 1);
  }
  let topTeamId = 0;
  let topCount = 0;
  for (const [id, c] of teamCounts.entries()) {
    if (c > topCount) {
      topCount = c;
      topTeamId = id;
    }
  }
  const topTeam = TEAMS.find((t) => t.team_id === topTeamId);
  const mostActive = topTeam ? { coach: topTeam.coach, count: topCount } : null;

  // Best / worst trade — highest & lowest winning-side probability
  let best: Summary['bestTrade'] = null;
  let worst: Summary['worstTrade'] = null;
  for (const it of items) {
    if (!it.latestProbability) continue;
    const probA = Number(it.latestProbability.team_a_probability);
    const probB = Number(it.latestProbability.team_b_probability);
    const winSide = probA >= probB
      ? { teamName: it.trade.team_a_name, prob: probA }
      : { teamName: it.trade.team_b_name, prob: probB };
    if (!best || winSide.prob > best.prob) best = { ...winSide, id: it.trade.id };

    const loseSide = probA <= probB
      ? { teamName: it.trade.team_a_name, prob: probA }
      : { teamName: it.trade.team_b_name, prob: probB };
    if (!worst || loseSide.prob < worst.prob) worst = { ...loseSide, id: it.trade.id };
  }

  // Most volatile — biggest range of team A probability across history
  let mostVolatile: Summary['mostVolatile'] = null;
  for (const it of items) {
    if (it.probabilityHistory.length < 2) continue;
    const probs = it.probabilityHistory.map((p) => Number(p.team_a_probability));
    const range = Math.max(...probs) - Math.min(...probs);
    if (!mostVolatile || range > mostVolatile.range) {
      mostVolatile = { id: it.trade.id, range };
    }
  }

  return { total: items.length, mostActive, bestTrade: best, worstTrade: worst, mostVolatile };
}

function SummaryBar({ summary }: { summary: Summary }) {
  const stats: { label: string; value: string }[] = [
    { label: 'Total trades', value: String(summary.total) },
  ];
  if (summary.mostActive) {
    stats.push({ label: 'Most active', value: `${summary.mostActive.coach} (${summary.mostActive.count})` });
  }
  if (summary.bestTrade) {
    stats.push({ label: 'Best trade', value: `${summary.bestTrade.teamName} ${summary.bestTrade.prob.toFixed(0)}%` });
  }
  if (summary.worstTrade && summary.worstTrade.prob < 50) {
    stats.push({ label: 'Worst trade', value: `${summary.worstTrade.teamName} ${summary.worstTrade.prob.toFixed(0)}%` });
  }
  if (summary.mostVolatile) {
    stats.push({ label: 'Most volatile', value: `±${summary.mostVolatile.range.toFixed(0)}%` });
  }

  return (
    <div className="flex flex-wrap gap-6 bg-white border border-border rounded-lg px-5 py-3 flex-1">
      {stats.map((s) => (
        <div key={s.label}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
          <p className="text-sm font-semibold">{s.value}</p>
        </div>
      ))}
    </div>
  );
}
