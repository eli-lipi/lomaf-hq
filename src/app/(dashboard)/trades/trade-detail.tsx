'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Trash2, Pencil } from 'lucide-react';
import LogTradeModal, { type InitialTradeData } from './log-trade-modal';
import {
  ComposedChart,
  Area,
  Line,
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

// League-average baseline by position — used to judge "expected" performance
// when a player has no pre_trade_avg (e.g. a bench player activated by the trade).
const POSITION_BASELINE: Record<string, number> = {
  DEF: 70,
  MID: 85,
  FWD: 70,
  RUC: 80,
};

function baselineForPlayer(p: { pre_trade_avg: number | null; position: string | null; raw_position: string | null }): number {
  if (p.pre_trade_avg != null && p.pre_trade_avg > 0) return p.pre_trade_avg;
  // Use normalized position first, then raw (first token of DPP)
  const pos = p.position || (p.raw_position?.split('/')[0] ?? '');
  return POSITION_BASELINE[pos] ?? 70;
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

  const colorA = getTeamColor(trade.team_a_id);
  const colorB = getTeamColor(trade.team_b_id);

  // Build chart data:
  //   - R(round_executed) is always a 50/50 anchor point (trade just executed).
  //   - Then one entry per subsequent round from probabilityHistory.
  //   - Dedupe: if probabilityHistory accidentally has a row at round_executed
  //     (legacy data), skip it.
  const chartRounds = new Map<number, { a: number; b: number }>();
  chartRounds.set(trade.round_executed, { a: 50, b: 50 });
  for (const p of probabilityHistory) {
    if (p.round_number === trade.round_executed) continue; // keep the 50/50 anchor
    chartRounds.set(p.round_number, {
      a: Number(p.team_a_probability),
      b: Number(p.team_b_probability),
    });
  }
  const chartData = Array.from(chartRounds.entries())
    .sort(([a], [b]) => a - b)
    .map(([round, v]) => ({
      round: `R${round}`,
      probA: v.a,
      probAbove: Math.max(v.a, 50), // for the team-A-winning zone fill
      probBelow: Math.min(v.a, 50), // for the team-B-winning zone fill
    }));

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

      {/* Header card — the hero */}
      <div className="bg-white border border-border rounded-lg p-6 space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Trade executed after Round {trade.round_executed}
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

      {/* AI-only context box */}
      <TradeContextBox
        aiNarrative={latestProbability?.ai_assessment ?? null}
        updatedRound={latestProbability?.round_number ?? null}
      />

      {/* Probability over time — single line, color zones above/below 50% */}
      <div className="bg-white border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-4">Probability over time</h3>
        {chartData.length < 2 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No round data yet — probabilities will appear after the next round&apos;s scores are uploaded.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="round" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: '#6B7280' }}
                width={44}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name !== 'probA') return [null, null] as unknown as [string, string];
                  const v = typeof value === 'number' ? value : Number(value);
                  return [`${Math.round(v)}% ${trade.team_a_name}`, 'Team A'];
                }}
                labelFormatter={(label) => `Round ${String(label).replace('R', '')}`}
                contentStyle={{ fontSize: 12 }}
              />
              {/* Team-A-winning zone: filled between line and 50 when line is above 50 */}
              <Area
                type="monotone"
                dataKey="probAbove"
                stroke="none"
                fill={colorA}
                fillOpacity={0.22}
                baseValue={50}
                isAnimationActive={false}
                legendType="none"
                activeDot={false}
              />
              {/* Team-B-winning zone: filled between line and 50 when line is below 50 */}
              <Area
                type="monotone"
                dataKey="probBelow"
                stroke="none"
                fill={colorB}
                fillOpacity={0.22}
                baseValue={50}
                isAnimationActive={false}
                legendType="none"
                activeDot={false}
              />
              {/* The single probability line (Team A %) */}
              <Line
                type="monotone"
                dataKey="probA"
                stroke="#111827"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#111827', stroke: '#FFFFFF', strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
              {/* Prominent midline at 50% */}
              <ReferenceLine
                y={50}
                stroke="#9CA3AF"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                label={{ value: 'EVEN', position: 'right', fill: '#6B7280', fontSize: 10, fontWeight: 600 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {chartData.length >= 2 && (
          <div className="flex items-center justify-center gap-6 mt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colorA, opacity: 0.5 }} />
              {trade.team_a_name} winning
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colorB, opacity: 0.5 }} />
              {trade.team_b_name} winning
            </span>
          </div>
        )}
      </div>

      {/* Factor breakdown — visual bars */}
      {factors && (
        <FactorBreakdown
          factors={factors}
          trade={trade}
          colorA={colorA}
          colorB={colorB}
        />
      )}

      {/* Per-round scores grid — colored relative to expected */}
      <PerRoundScoresGrid
        performance={playerPerformance}
        roundExecuted={trade.round_executed}
        latestRound={latestProbability?.round_number ?? trade.round_executed}
      />

      {/* Per-player summary */}
      <PerPlayerSummary performance={playerPerformance} />

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
// Factor breakdown — mini directional bars
// ============================================================

function FactorBreakdown({
  factors,
  trade,
  colorA,
  colorB,
}: {
  factors: TradeFactorsBreakdown;
  trade: Trade;
  colorA: string;
  colorB: string;
}) {
  return (
    <div className="bg-white border border-border rounded-lg p-5">
      <h3 className="text-sm font-semibold mb-4">Factor breakdown</h3>
      <div className="space-y-4">
        <FactorBar
          label="Production edge"
          value={factors.productionEdge}
          maxAbs={80}
          colorA={colorA}
          colorB={colorB}
          valueText={
            factors.productionEdge >= 0
              ? `+${factors.productionEdge.toFixed(1)} pts/rd → ${trade.team_a_name}`
              : `${factors.productionEdge.toFixed(1)} pts/rd → ${trade.team_b_name}`
          }
          sub={`Avg ${factors.avgA.toFixed(1)} (A) vs ${factors.avgB.toFixed(1)} (B)`}
        />
        <FactorBar
          label="Positional scarcity"
          value={factors.scarcityEdge}
          maxAbs={20}
          colorA={colorA}
          colorB={colorB}
          valueText={
            Math.abs(factors.scarcityEdge) < 0.1
              ? 'Even'
              : factors.scarcityEdge > 0
              ? `+${factors.scarcityEdge.toFixed(1)} pts/rd adj → ${trade.team_a_name}`
              : `${factors.scarcityEdge.toFixed(1)} pts/rd adj → ${trade.team_b_name}`
          }
          sub="Bonus for rarer positions (RUC, FWD, DEF)"
        />
        <FactorBar
          label="Projected value (injury)"
          value={factors.projectedEdge}
          maxAbs={80}
          colorA={colorA}
          colorB={colorB}
          valueText={
            Math.abs(factors.projectedEdge) < 0.1
              ? 'No injured players'
              : factors.projectedEdge > 0
              ? `+${factors.projectedEdge.toFixed(1)} pts/rd → ${trade.team_a_name}`
              : `${factors.projectedEdge.toFixed(1)} pts/rd → ${trade.team_b_name}`
          }
          sub="Projected return value of injured acquisitions"
        />
        <FactorBar
          label="AI strategic edge"
          // AI nudge is in pct points; scale to match the pts/rd bars roughly
          value={factors.aiPctNudge}
          maxAbs={10}
          colorA={colorA}
          colorB={colorB}
          valueText={
            factors.aiEdge === 'even'
              ? 'Even'
              : `${factors.aiEdge === 'team_a' ? trade.team_a_name : trade.team_b_name} (magnitude ${factors.aiMagnitude}/10)`
          }
          sub={`${factors.aiPctNudge > 0 ? '+' : ''}${factors.aiPctNudge.toFixed(1)}% probability nudge`}
        />
        <ConfidenceBar
          confidence={factors.confidence}
          roundsSince={factors.roundsSince}
        />
      </div>
    </div>
  );
}

function FactorBar({
  label,
  value,
  maxAbs,
  colorA,
  colorB,
  valueText,
  sub,
}: {
  label: string;
  value: number;
  maxAbs: number;
  colorA: string;
  colorB: string;
  valueText: string;
  sub?: string;
}) {
  // Normalize value to -1..+1 for bar rendering. Clip at the band edges.
  const clamped = Math.max(-1, Math.min(1, value / maxAbs));
  const pct = Math.abs(clamped) * 50; // 0..50% of bar width from center
  const isA = value >= 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold tabular-nums">{valueText}</span>
      </div>
      <div className="relative w-full h-2.5 bg-muted rounded-full overflow-hidden">
        {/* Center divider */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border z-10" />
        {isA ? (
          <div
            className="absolute top-0 bottom-0 rounded-full transition-all"
            style={{
              left: '50%',
              width: `${pct}%`,
              backgroundColor: colorA,
            }}
          />
        ) : (
          <div
            className="absolute top-0 bottom-0 rounded-full transition-all"
            style={{
              right: '50%',
              width: `${pct}%`,
              backgroundColor: colorB,
            }}
          />
        )}
      </div>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function ConfidenceBar({ confidence, roundsSince }: { confidence: number; roundsSince: number }) {
  const pct = Math.max(0, Math.min(1, confidence)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-xs font-medium text-muted-foreground">Confidence</span>
        <span className="text-xs font-semibold tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="relative w-full h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className="absolute top-0 bottom-0 left-0 rounded-full bg-slate-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        {roundsSince} round{roundsSince === 1 ? '' : 's'} of data · full confidence at 8 rounds
      </p>
    </div>
  );
}

// ============================================================
// Per-round scores grid — colored relative to expected
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

  // Score coloring: relative to baseline (pre_trade_avg, or position league avg)
  const cellClass = (pts: number | null | undefined, hasRound: boolean, baseline: number): string => {
    if (!hasRound) return 'bg-gray-50 text-muted-foreground';
    if (pts == null) return 'bg-gray-100 text-gray-500 italic';
    const diff = pts - baseline;
    if (diff >= 20) return 'bg-green-200 text-green-900 font-bold';
    if (diff >= 5) return 'bg-green-50 text-green-800';
    if (diff <= -20) return 'bg-red-100 text-red-800';
    if (diff <= -5) return 'bg-orange-50 text-orange-800';
    return 'bg-gray-50 text-gray-700';
  };

  return (
    <div className="bg-white border border-border rounded-lg p-5">
      <h3 className="text-sm font-semibold mb-1">Scores since trade</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Colored by score vs. player&apos;s expected output (pre-trade avg, or league avg for their
        position). Green = above expected, red = well below, DNP = did not play.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="py-2 pr-4 text-left font-medium">Player</th>
              <th className="py-2 pr-4 text-left font-medium">→ Team</th>
              <th className="py-2 pr-3 text-right font-medium">Expected</th>
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
              const baseline = baselineForPlayer(p);
              return (
                <tr key={p.player_id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-medium whitespace-nowrap">
                    {p.player_name}
                    {p.raw_position && (
                      <span className="text-muted-foreground ml-1 text-xs">({p.raw_position})</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs whitespace-nowrap">{p.receiving_team_name}</td>
                  <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                    {baseline.toFixed(0)}
                  </td>
                  {rounds.map((r) => {
                    const pts = scoreByRound.get(r);
                    const hasRound = scoreByRound.has(r);
                    return (
                      <td key={r} className="py-1 px-1 text-center">
                        <span
                          className={`inline-block min-w-[2.5rem] px-2 py-1 rounded text-xs tabular-nums ${cellClass(pts, hasRound, baseline)}`}
                        >
                          {!hasRound ? '—' : pts == null ? 'DNP' : pts}
                        </span>
                      </td>
                    );
                  })}
                  <td className="py-2 pl-3 text-right tabular-nums text-sm font-medium">
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

// ============================================================
// Per-player summary table
// ============================================================

function PerPlayerSummary({ performance }: { performance: PlayerPerformance[] }) {
  return (
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
            {performance.map((p) => {
              const isInjured = p.injured;
              const hasPost = p.rounds_played > 0;
              const delta = hasPost && p.pre_trade_avg != null
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
                  {/* Post-trade avg — shows "Injured" when no data + injury flag */}
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {isInjured && !hasPost ? (
                      <span className="text-red-600 text-xs font-medium">🔴 Injured</span>
                    ) : hasPost ? (
                      p.post_trade_avg.toFixed(0)
                    ) : (
                      '—'
                    )}
                  </td>
                  {/* Δ — shows projected return avg when injured */}
                  <td className="py-2 pr-4 text-right text-xs tabular-nums">
                    {isInjured && !hasPost && p.pre_trade_avg != null ? (
                      <span className="text-amber-600 italic">
                        Proj. {p.pre_trade_avg.toFixed(0)}
                      </span>
                    ) : delta == null ? (
                      '—'
                    ) : (
                      <span className={delta >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {delta >= 0 ? '+' : ''}
                        {delta.toFixed(0)}
                      </span>
                    )}
                  </td>
                  <td className={`py-2 pr-4 text-right text-xs tabular-nums ${isInjured && !hasPost ? 'text-red-600' : ''}`}>
                    {p.rounds_played}/{p.rounds_possible}
                  </td>
                  <td className="py-2 text-xs">
                    {isInjured ? (
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
  );
}
