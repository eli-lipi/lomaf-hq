'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Trash2, Pencil } from 'lucide-react';
import LogTradeModal, { type InitialTradeData } from './log-trade-modal';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import ProbabilityBar from './probability-bar';
import TradeContextBox from './trade-context-box';
import { getTeamColor } from '@/lib/team-colors';
import type {
  PlayerPerformance,
  Trade,
  TradePlayer,
  TradeProbability,
  TradeFactorsBreakdown,
} from '@/lib/trades/types';

interface DetailData {
  trade: Trade;
  players: TradePlayer[];
  latestProbability: TradeProbability | null;
  probabilityHistory: TradeProbability[];
  playerPerformance: PlayerPerformance[];
}

interface Props {
  tradeId: string;
  onBack: () => void;
  onDeleted: () => void;
}

export default function TradeDetail({ tradeId, onBack, onDeleted }: Props) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/trades/${tradeId}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeId]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    await fetch(`/api/trades/${tradeId}/recalculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    await load();
    setRecalculating(false);
  };

  const handleDelete = async () => {
    if (!confirm('Delete this trade? This cannot be undone.')) return;
    await fetch(`/api/trades/${tradeId}`, { method: 'DELETE' });
    onDeleted();
  };

  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading...</div>;
  if (!data) return <div className="py-12 text-center text-muted-foreground">Trade not found.</div>;

  const { trade, players, latestProbability, probabilityHistory, playerPerformance } = data;
  const teamAPlayers = players.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamBPlayers = players.filter((p) => p.receiving_team_id === trade.team_b_id);
  const probA = latestProbability?.team_a_probability ?? 50;
  const probB = latestProbability?.team_b_probability ?? 50;

  // Chart data: prepend the trade execution point as 50/50
  const chartData = [
    { round: `R${trade.round_executed}`, a: 50, b: 50 },
    ...probabilityHistory.map((p) => ({
      round: `R${p.round_number}`,
      a: Number(p.team_a_probability),
      b: Number(p.team_b_probability),
    })),
  ];

  const factors = latestProbability?.factors as TradeFactorsBreakdown | null;

  const editInitial: InitialTradeData = {
    tradeId: trade.id,
    teamAId: trade.team_a_id,
    teamBId: trade.team_b_id,
    roundExecuted: trade.round_executed,
    contextNotes: trade.context_notes ?? '',
    players: players.map((p) => ({
      player_id: p.player_id,
      player_name: p.player_name,
      pos: p.raw_position,
      receiving_team_id: p.receiving_team_id,
    })),
  };

  return (
    <div className="space-y-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} /> Back to all trades
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 rounded transition-colors"
          >
            <Pencil size={12} /> Edit
          </button>
          <button
            onClick={handleRecalculate}
            disabled={recalculating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 rounded transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={recalculating ? 'animate-spin' : ''} />
            Recalculate
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>

      {/* Header card */}
      <div className="bg-white border border-border rounded-lg p-6 space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Trade executed Round {trade.round_executed}
          </p>
          <h2 className="text-xl font-bold mt-1">
            {trade.team_a_name} ←→ {trade.team_b_name}
          </h2>
        </div>

        <ProbabilityBar
          teamAId={trade.team_a_id}
          teamAName={trade.team_a_name}
          teamBId={trade.team_b_id}
          teamBName={trade.team_b_name}
          probA={probA}
          probB={probB}
          large
        />

        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {trade.team_a_name} receives
            </p>
            <ul className="space-y-1">
              {teamAPlayers.map((p) => (
                <li key={p.id} className="text-sm">
                  • {p.player_name}
                  {p.raw_position && (
                    <span className="text-muted-foreground ml-1">({p.raw_position})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {trade.team_b_name} receives
            </p>
            <ul className="space-y-1">
              {teamBPlayers.map((p) => (
                <li key={p.id} className="text-sm">
                  • {p.player_name}
                  {p.raw_position && (
                    <span className="text-muted-foreground ml-1">({p.raw_position})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Context box */}
      <TradeContextBox
        contextNotes={trade.context_notes}
        aiNarrative={latestProbability?.ai_assessment ?? null}
        updatedRound={latestProbability?.round_number ?? null}
      />

      {/* Polymarket chart */}
      <div className="bg-white border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-4">Probability over time</h3>
        {chartData.length < 2 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No round data yet — probabilities will appear after the next round&apos;s scores are uploaded.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} stackOffset="expand">
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="round" tick={{ fontSize: 11 }} />
              <YAxis
                domain={[0, 1]}
                tickFormatter={(v) => `${Math.round(v * 100)}%`}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value, name) => {
                  const v = typeof value === 'number' ? value : Number(value);
                  const label = name === 'a' ? trade.team_a_name : trade.team_b_name;
                  return [`${(v * 100).toFixed(0)}%`, label];
                }}
              />
              <ReferenceLine y={0.5} stroke="#9CA3AF" strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="a"
                stackId="1"
                stroke={getTeamColor(trade.team_a_id)}
                fill={getTeamColor(trade.team_a_id)}
                fillOpacity={0.7}
              />
              <Area
                type="monotone"
                dataKey="b"
                stackId="1"
                stroke={getTeamColor(trade.team_b_id)}
                fill={getTeamColor(trade.team_b_id)}
                fillOpacity={0.7}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Factor breakdown */}
      {factors && (
        <div className="bg-white border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold mb-3">Factor breakdown</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <FactorRow
              label="Production edge"
              value={`${factors.productionEdge > 0 ? '+' : ''}${factors.productionEdge.toFixed(1)} pts/rd to ${factors.productionEdge >= 0 ? 'A' : 'B'}`}
              sub={`Avg ${factors.avgA.toFixed(1)} (A) vs ${factors.avgB.toFixed(1)} (B)`}
            />
            <FactorRow
              label="Positional scarcity"
              value={`${factors.scarcityEdge > 0 ? '+' : ''}${factors.scarcityEdge.toFixed(1)} pts/rd adj`}
            />
            <FactorRow
              label="Projected value (injury)"
              value={`${factors.projectedEdge > 0 ? '+' : ''}${factors.projectedEdge.toFixed(1)} pts/rd to ${factors.projectedEdge >= 0 ? 'A' : 'B'}`}
            />
            <FactorRow
              label="AI strategic edge"
              value={
                factors.aiEdge === 'even'
                  ? 'Even'
                  : `${factors.aiEdge === 'team_a' ? trade.team_a_name : trade.team_b_name} (mag ${factors.aiMagnitude})`
              }
              sub={`${factors.aiPctNudge > 0 ? '+' : ''}${factors.aiPctNudge.toFixed(1)}% to A`}
            />
            <FactorRow
              label="Confidence"
              value={`${(factors.confidence * 100).toFixed(0)}%`}
              sub={`${factors.roundsSince} rounds of data`}
            />
          </div>
        </div>
      )}

      {/* Per-round scores grid — the raw data behind the analysis */}
      <PerRoundScoresGrid
        performance={playerPerformance}
        roundExecuted={trade.round_executed}
        latestRound={latestProbability?.round_number ?? trade.round_executed}
      />

      {/* Per-player summary table */}
      <div className="bg-white border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-3">Per-player summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-4">Player</th>
                <th className="py-2 pr-4">→ Team</th>
                <th className="py-2 pr-4">Position</th>
                <th className="py-2 pr-4 text-right">Pre-trade avg</th>
                <th className="py-2 pr-4 text-right">Post-trade avg</th>
                <th className="py-2 pr-4 text-right">Δ</th>
                <th className="py-2 pr-4 text-right">Rounds</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {playerPerformance.map((p) => {
                const delta = p.rounds_played > 0 && p.pre_trade_avg != null
                  ? p.post_trade_avg - p.pre_trade_avg
                  : null;
                return (
                  <tr key={p.player_id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 font-medium">{p.player_name}</td>
                    <td className="py-2 pr-4 text-xs">{p.receiving_team_name}</td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">{p.raw_position ?? '?'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.pre_trade_avg?.toFixed(0) ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.rounds_played > 0 ? p.post_trade_avg.toFixed(0) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-right text-xs tabular-nums">
                      {delta == null ? '—' : (
                        <span className={delta >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {delta >= 0 ? '+' : ''}{delta.toFixed(0)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right text-xs tabular-nums">
                      {p.rounds_played}/{p.rounds_possible}
                    </td>
                    <td className="py-2 text-xs">
                      {p.injured ? (
                        <span className="text-red-600">🔴 Injured</span>
                      ) : (
                        <span className="text-green-600">✅ Active</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <LogTradeModal
          initial={editInitial}
          onClose={() => setEditing(false)}
          onCreated={() => {
            setEditing(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Per-round scores grid — cells colored by score band
// ============================================================

function PerRoundScoresGrid({
  performance,
  roundExecuted,
  latestRound,
}: {
  performance: PlayerPerformance[];
  roundExecuted: number;
  latestRound: number;
}) {
  if (performance.length === 0 || latestRound <= roundExecuted) {
    return (
      <div className="bg-white border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-1">Scores since trade</h3>
        <p className="text-sm text-muted-foreground py-4 text-center">
          Trade just logged — scores will appear here after R{roundExecuted + 1} is uploaded.
        </p>
      </div>
    );
  }

  const rounds: number[] = [];
  for (let r = roundExecuted + 1; r <= latestRound; r++) rounds.push(r);

  const scoreColor = (pts: number | null | undefined): string => {
    if (pts == null) return 'bg-gray-100 text-muted-foreground';
    if (pts === 0) return 'bg-red-100 text-red-700';
    if (pts < 60) return 'bg-orange-50 text-orange-700';
    if (pts < 80) return 'bg-yellow-50 text-yellow-800';
    if (pts < 100) return 'bg-lime-50 text-lime-800';
    return 'bg-green-100 text-green-800 font-semibold';
  };

  return (
    <div className="bg-white border border-border rounded-lg p-5">
      <h3 className="text-sm font-semibold mb-1">Scores since trade</h3>
      <p className="text-xs text-muted-foreground mb-4">
        All rounds since trade took effect (R{roundExecuted + 1} onwards). Colored by score band;
        DNP = did not play.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="py-2 pr-4 text-left font-medium">Player</th>
              <th className="py-2 pr-4 text-left font-medium">→ Team</th>
              {rounds.map((r) => (
                <th key={r} className="py-2 px-2 text-center font-medium">
                  R{r}
                </th>
              ))}
              <th className="py-2 pl-3 text-right font-medium">Avg</th>
            </tr>
          </thead>
          <tbody>
            {performance.map((p) => {
              const scoreByRound = new Map<number, number | null>();
              for (const s of p.round_scores) scoreByRound.set(s.round, s.points);
              return (
                <tr key={p.player_id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-medium whitespace-nowrap">
                    {p.player_name}
                    {p.raw_position && (
                      <span className="text-muted-foreground ml-1 text-xs">({p.raw_position})</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs whitespace-nowrap">{p.receiving_team_name}</td>
                  {rounds.map((r) => {
                    const pts = scoreByRound.get(r);
                    const hasRound = scoreByRound.has(r);
                    return (
                      <td key={r} className="py-1 px-1 text-center">
                        <span
                          className={`inline-block min-w-[2.5rem] px-2 py-1 rounded text-xs tabular-nums ${scoreColor(pts)}`}
                        >
                          {!hasRound ? '—' : pts == null ? 'DNP' : pts}
                        </span>
                      </td>
                    );
                  })}
                  <td className="py-2 pl-3 text-right tabular-nums text-sm">
                    {p.rounds_played > 0 ? p.post_trade_avg.toFixed(0) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FactorRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <div className="font-medium tabular-nums">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
