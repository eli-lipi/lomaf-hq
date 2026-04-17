'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Trash2, Pencil, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';
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
import { getTeamColor } from '@/lib/team-colors';
import { cleanPositionDisplay } from '@/lib/trades/positions';
import type {
  PlayerPerformance,
  Trade,
  TradePlayer,
  TradeProbability,
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

// League-avg baseline by position, used when a player has no pre-trade avg
const POSITION_BASELINE: Record<string, number> = { DEF: 70, MID: 85, FWD: 70, RUC: 80 };

function displayPosition(p: {
  draft_position: string | null;
  raw_position: string | null;
}): string {
  // Prefer draft position (stable, never 'BN'). Fall back to cleaned raw_position
  // (strips UTL/BN which are lineup slots, not real positions).
  return p.draft_position || cleanPositionDisplay(p.raw_position) || '?';
}

function baselineForPerformance(p: PlayerPerformance): number {
  if (p.pre_trade_avg != null && p.pre_trade_avg > 0) return p.pre_trade_avg;
  // Use cleaned position — never match on UTL/BN which are lineup slots
  const cleaned = cleanPositionDisplay(p.draft_position) ?? cleanPositionDisplay(p.raw_position);
  const pos = p.position || (cleaned?.split('/')[0] ?? '');
  return POSITION_BASELINE[pos] ?? 70;
}

export default function TradeDetail({ tradeId, onBack, onDeleted }: Props) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

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

  // Chart data must be computed before any early returns to satisfy Rules of Hooks.
  // We derive from `data` (which may be null on first render).
  const chartData = useMemo(() => {
    if (!data) return [] as { round: string; probA: number; probAbove: number; probBelow: number }[];
    const map = new Map<number, number>();
    map.set(data.trade.round_executed, 50);
    for (const p of data.probabilityHistory) {
      if (p.round_number === data.trade.round_executed) continue;
      map.set(p.round_number, Number(p.team_a_probability));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([round, pa]) => ({
        round: `R${round}`,
        probA: pa,
        probAbove: Math.max(pa, 50),
        probBelow: Math.min(pa, 50),
      }));
  }, [data]);

  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading...</div>;
  if (!data) return <div className="py-12 text-center text-muted-foreground">Trade not found.</div>;

  const { trade, players, latestProbability, probabilityHistory, playerPerformance } = data;
  const teamAPlayers = players.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamBPlayers = players.filter((p) => p.receiving_team_id === trade.team_b_id);
  const perfById = new Map(playerPerformance.map((p) => [p.player_id, p]));

  const probA = latestProbability?.team_a_probability ?? 50;
  const probB = latestProbability?.team_b_probability ?? 50;

  const colorA = getTeamColor(trade.team_a_id);
  const colorB = getTeamColor(trade.team_b_id);

  // Hero side — whichever team is currently winning
  const winningIsA = probA >= probB;
  const heroPct = winningIsA ? probA : probB;
  const heroTeamName = winningIsA ? trade.team_a_name : trade.team_b_name;
  const heroColor = winningIsA ? colorA : colorB;

  // Change since previous round (for the hero badge) — look at same side's previous value
  const sortedHistory = [...probabilityHistory].sort((a, b) => a.round_number - b.round_number);
  let heroDelta: number | null = null;
  if (sortedHistory.length >= 2) {
    const last = sortedHistory[sortedHistory.length - 1];
    const prev = sortedHistory[sortedHistory.length - 2];
    const latestSide = winningIsA ? Number(last.team_a_probability) : Number(last.team_b_probability);
    const prevSide = winningIsA ? Number(prev.team_a_probability) : Number(prev.team_b_probability);
    heroDelta = latestSide - prevSide;
  } else if (sortedHistory.length === 1) {
    // Compare against the R(executed) 50/50 starting point
    const last = sortedHistory[0];
    const latestSide = winningIsA ? Number(last.team_a_probability) : Number(last.team_b_probability);
    heroDelta = latestSide - 50;
  }

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
    <div className="space-y-4">
      {/* Back + actions (kept on light background) */}
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

      {/* The Polymarket-style dark card */}
      <div className="bg-[#0B1120] text-white rounded-xl p-6 md:p-8 space-y-7 shadow-lg">
        {/* Header */}
        <div className="text-center md:text-left">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">
            Trade executed after Round {trade.round_executed}
          </p>
          <h2 className="text-2xl md:text-3xl font-bold mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 justify-center md:justify-start">
            <span>{trade.team_a_name}</span>
            <span className="text-slate-500 text-xl">←→</span>
            <span>{trade.team_b_name}</span>
          </h2>
        </div>

        {/* Player cards — grid with the two sides */}
        <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center md:text-left">
              {trade.team_a_name} receives
            </p>
            {teamAPlayers.map((p) => (
              <PlayerCard
                key={p.id}
                tradePlayer={p}
                performance={perfById.get(p.player_id)}
              />
            ))}
          </div>
          <div className="text-slate-600 text-3xl font-light text-center hidden md:block">⇄</div>
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center md:text-left">
              {trade.team_b_name} receives
            </p>
            {teamBPlayers.map((p) => (
              <PlayerCard
                key={p.id}
                tradePlayer={p}
                performance={perfById.get(p.player_id)}
              />
            ))}
          </div>
        </div>

        {/* Probability bar */}
        <DarkProbabilityBar
          teamAName={trade.team_a_name}
          teamBName={trade.team_b_name}
          probA={probA}
          probB={probB}
          colorA={colorA}
          colorB={colorB}
        />

        {/* AI narrative */}
        {latestProbability?.ai_assessment && (
          <div className="border-t border-slate-800 pt-5">
            <div className="flex items-start gap-3">
              <span className="text-xl leading-none mt-0.5">🧠</span>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Trade Context
                  </p>
                  {latestProbability.round_number !== null && (
                    <p className="text-[10px] text-slate-500">Updated R{latestProbability.round_number}</p>
                  )}
                </div>
                <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {latestProbability.ai_assessment}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Hero % + chart */}
        <div className="border-t border-slate-800 pt-6 space-y-5">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div
                className="text-[56px] md:text-[72px] font-bold leading-none tabular-nums"
                style={{ color: heroColor }}
              >
                {Math.round(heroPct)}%
              </div>
              <p className="text-sm text-slate-400 mt-1 font-medium">{heroTeamName} winning</p>
            </div>
            {heroDelta !== null && Math.abs(heroDelta) >= 0.5 && (
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${
                  heroDelta >= 0
                    ? 'bg-green-500/15 text-green-400'
                    : 'bg-red-500/15 text-red-400'
                }`}
              >
                {heroDelta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {heroDelta >= 0 ? '+' : ''}
                {heroDelta.toFixed(1)}% since last round
              </div>
            )}
          </div>

          <div className="rounded-lg overflow-hidden bg-[#111827] p-4 pr-6">
            {chartData.length < 2 ? (
              <p className="text-sm text-slate-500 py-12 text-center">
                No round data yet — probabilities will appear after the next round&apos;s scores are uploaded.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 24, bottom: 6, left: 0 }}>
                  <defs>
                    <linearGradient id="heroLineFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={heroColor} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={heroColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                  <XAxis
                    dataKey="round"
                    tick={{ fontSize: 11, fill: '#9CA3AF' }}
                    axisLine={{ stroke: '#1F2937' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#9CA3AF' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '3 3' }}
                    formatter={(value, name) => {
                      if (name !== 'probA') return [null, null] as unknown as [string, string];
                      const v = typeof value === 'number' ? value : Number(value);
                      const side = v >= 50 ? trade.team_a_name : trade.team_b_name;
                      const sidePct = v >= 50 ? v : 100 - v;
                      return [`${Math.round(sidePct)}% ${side}`, 'Winning'];
                    }}
                    labelFormatter={(label) => `Round ${String(label).replace('R', '')}`}
                    contentStyle={{
                      fontSize: 12,
                      background: '#0B1120',
                      border: '1px solid #1F2937',
                      borderRadius: 6,
                      color: '#F3F4F6',
                    }}
                    labelStyle={{ color: '#9CA3AF' }}
                  />
                  {/* Faint area fill under the curve, only where team A is winning */}
                  <Area
                    type="monotone"
                    dataKey="probAbove"
                    stroke="none"
                    fill={`url(#heroLineFill)`}
                    baseValue={50}
                    isAnimationActive={false}
                    legendType="none"
                    activeDot={false}
                  />
                  {/* Area fill when team B is winning, same subtle treatment */}
                  <Area
                    type="monotone"
                    dataKey="probBelow"
                    stroke="none"
                    fill={colorB}
                    fillOpacity={0.12}
                    baseValue={50}
                    isAnimationActive={false}
                    legendType="none"
                    activeDot={false}
                  />
                  {/* Subtle dashed EVEN line */}
                  <ReferenceLine y={50} stroke="#374151" strokeDasharray="4 4" strokeWidth={1} />
                  {/* The hero probability line. The last point is highlighted with a glow ring
                      to match Polymarket's "current contract price" feel. */}
                  <Line
                    type="monotone"
                    dataKey="probA"
                    stroke={heroColor}
                    strokeWidth={2.5}
                    dot={((dotProps: Record<string, unknown>) => {
                      const cx = dotProps.cx as number | undefined;
                      const cy = dotProps.cy as number | undefined;
                      const index = dotProps.index as number | undefined;
                      const k = String(dotProps.key ?? index ?? '');
                      if (cx == null || cy == null) return <g key={k} />;
                      const isLast = index === chartData.length - 1;
                      if (isLast) {
                        return (
                          <g key={k}>
                            <circle cx={cx} cy={cy} r={9} fill={heroColor} opacity={0.2} />
                            <circle cx={cx} cy={cy} r={5.5} fill={heroColor} stroke="#0B1120" strokeWidth={2} />
                          </g>
                        );
                      }
                      return <circle key={k} cx={cx} cy={cy} r={3} fill={heroColor} />;
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }) as any}
                    activeDot={{ r: 6, fill: heroColor, stroke: '#0B1120', strokeWidth: 3 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Show details toggle */}
        <div className="border-t border-slate-800 pt-4 text-center">
          <button
            onClick={() => setShowDetails((s) => !s)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            {showDetails ? 'Hide detailed breakdown' : 'Show detailed breakdown'}
            <ChevronDown
              size={14}
              className={`transition-transform ${showDetails ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Deep dive — only visible when expanded. Factor breakdown is kept in the
          database (`trade_probabilities.factors`) but hidden from the UI per Lipi's
          request — the numbers were confusing without context. */}
      {showDetails && (
        <div className="space-y-4">
          <PerRoundScoresGrid
            performance={playerPerformance}
            roundExecuted={trade.round_executed}
            latestRound={latestProbability?.round_number ?? trade.round_executed}
          />
          <PerPlayerSummary performance={playerPerformance} />
        </div>
      )}

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
// Dark player card — one per player in the trade
// ============================================================

function PlayerCard({
  tradePlayer,
  performance,
}: {
  tradePlayer: TradePlayer;
  performance: PlayerPerformance | undefined;
}) {
  const injured = performance?.injured ?? false;
  const pos = performance
    ? displayPosition(performance)
    : cleanPositionDisplay(tradePlayer.raw_position) ?? '?';
  const pre = tradePlayer.pre_trade_avg;
  const post = performance?.post_trade_avg ?? 0;
  const roundsPlayed = performance?.rounds_played ?? 0;

  // Which average to feature: pre-trade if injured (or no post-trade data yet),
  // otherwise post-trade
  const featured = injured || roundsPlayed === 0
    ? { label: 'Pre-trade', value: pre }
    : { label: 'Post-trade', value: post };

  return (
    <div className="bg-slate-800/60 border border-slate-700/70 rounded-lg px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white truncate">{tradePlayer.player_name}</p>
          <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
            <span className="font-medium">{pos}</span>
            {featured.value != null && featured.value > 0 && (
              <>
                <span className="mx-1.5 text-slate-600">·</span>
                {featured.label} {featured.value.toFixed(0)}
              </>
            )}
          </p>
        </div>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
            injured
              ? 'bg-red-500/20 text-red-400'
              : 'bg-green-500/20 text-green-400'
          }`}
        >
          {injured ? '🔴 Injured' : '✅ Active'}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Dark probability bar (inlined for the hero card)
// ============================================================

function DarkProbabilityBar({
  teamAName,
  teamBName,
  probA,
  probB,
  colorA,
  colorB,
}: {
  teamAName: string;
  teamBName: string;
  probA: number;
  probB: number;
  colorA: string;
  colorB: string;
}) {
  const showAInside = probA >= 20;
  const showBInside = probB >= 20;

  return (
    <div className="w-full">
      {(!showAInside || !showBInside) && (
        <div className="flex items-center justify-between mb-1.5 text-sm font-semibold">
          {!showAInside ? (
            <span className="flex items-center gap-1.5" style={{ color: colorA }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorA }} />
              {teamAName} {Math.round(probA)}%
            </span>
          ) : (
            <span />
          )}
          {!showBInside ? (
            <span className="flex items-center gap-1.5" style={{ color: colorB }}>
              {teamBName} {Math.round(probB)}%
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorB }} />
            </span>
          ) : (
            <span />
          )}
        </div>
      )}
      <div className="relative w-full rounded-lg overflow-hidden flex" style={{ height: 36 }}>
        <div
          className="h-full flex items-center pl-3 transition-all duration-300"
          style={{ width: `${probA}%`, backgroundColor: colorA }}
        >
          {showAInside && (
            <div className="flex items-baseline gap-2 text-white truncate">
              <span className="text-lg font-bold tabular-nums">{Math.round(probA)}%</span>
              <span className="text-xs font-medium opacity-90 truncate">{teamAName}</span>
            </div>
          )}
        </div>
        <div
          className="h-full flex items-center justify-end pr-3 transition-all duration-300"
          style={{ width: `${probB}%`, backgroundColor: colorB }}
        >
          {showBInside && (
            <div className="flex items-baseline gap-2 text-white truncate">
              <span className="text-xs font-medium opacity-90 truncate">{teamBName}</span>
              <span className="text-lg font-bold tabular-nums">{Math.round(probB)}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Deep-dive: Per-round scores grid
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
        Colored by score vs. player&apos;s expected output. Green = above expected, red = well below.
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
              const baseline = baselineForPerformance(p);
              return (
                <tr key={p.player_id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-medium whitespace-nowrap">
                    {p.player_name}
                    <span className="text-muted-foreground ml-1 text-xs">
                      ({displayPosition(p)})
                    </span>
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
// Deep-dive: Per-player summary
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
              const delta = hasPost && p.pre_trade_avg != null ? p.post_trade_avg - p.pre_trade_avg : null;
              return (
                <tr key={p.player_id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-medium">{p.player_name}</td>
                  <td className="py-2 pr-4 text-xs">{p.receiving_team_name}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">{displayPosition(p)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{p.pre_trade_avg?.toFixed(0) ?? '—'}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {isInjured && !hasPost ? (
                      <span className="text-red-600 text-xs font-medium">🔴 Injured</span>
                    ) : hasPost ? (
                      p.post_trade_avg.toFixed(0)
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right text-xs tabular-nums">
                    {isInjured && !hasPost && p.pre_trade_avg != null ? (
                      <span className="text-amber-600 italic">Proj. {p.pre_trade_avg.toFixed(0)}</span>
                    ) : delta == null ? (
                      '—'
                    ) : (
                      <span className={delta >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {delta >= 0 ? '+' : ''}
                        {delta.toFixed(0)}
                      </span>
                    )}
                  </td>
                  <td
                    className={`py-2 pr-4 text-right text-xs tabular-nums ${isInjured && !hasPost ? 'text-red-600' : ''}`}
                  >
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
