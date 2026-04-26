'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  Pencil,
  TrendingUp,
  TrendingDown,
  ChevronDown,
} from 'lucide-react';
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
import { cleanPositionDisplay } from '@/lib/trades/positions';
import type {
  PlayerPerformance,
  Trade,
  TradePlayer,
  TradeProbability,
} from '@/lib/trades/types';

// ============================================================
// Design tokens — Polymarket-inspired dark theme
// ============================================================
const BG = '#0A0F1C';                     // page background
const SURFACE = 'rgba(255,255,255,0.03)'; // elevated panel
const BORDER = 'rgba(255,255,255,0.08)';
const ACCENT = '#A3FF12';                 // LOMAF green — winner / chart line / trade marker
const ACCENT_FILL = 'rgba(163,255,18,0.10)';
const TEXT = '#FFFFFF';
const TEXT_BODY = '#9AA3B5';
const TEXT_MUTED = '#6B7589';
const STATUS_INJURED = '#E24B4A';

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
  return p.draft_position || cleanPositionDisplay(p.raw_position) || '—';
}

function baselineForPerformance(p: PlayerPerformance): number {
  if (p.pre_trade_avg != null && p.pre_trade_avg > 0) return p.pre_trade_avg;
  const cleaned = cleanPositionDisplay(p.draft_position) ?? cleanPositionDisplay(p.raw_position);
  const pos = p.position || (cleaned?.split('/')[0] ?? '');
  return POSITION_BASELINE[pos] ?? 70;
}

// ============================================================
// Verdict logic — converts the current win prob into a one-line take
// ============================================================
type VerdictLevel = 'flip' | 'slight' | 'edge' | 'robbery';

interface Verdict {
  level: VerdictLevel;
  text: string;
  team: 'A' | 'B' | null;
}

function computeVerdict(probA: number, probB: number, teamAName: string, teamBName: string): Verdict {
  const aWins = probA >= probB;
  const winPct = aWins ? probA : probB;
  const winName = aWins ? teamAName : teamBName;
  const team = aWins ? 'A' : 'B';

  if (winPct < 55) return { level: 'flip', text: 'Coin flip', team: null };
  if (winPct < 65) return { level: 'slight', text: `Slight edge — ${winName}`, team };
  if (winPct < 80) return { level: 'edge', text: `Edge — ${winName}`, team };
  return { level: 'robbery', text: `Robbery — ${winName}`, team };
}

// ============================================================
// Auto-zoom Y-axis logic — keeps small probability moves visible
// ============================================================
function autoZoomDomain(values: number[]): [number, number] {
  if (values.length === 0) return [30, 70];
  const min = Math.min(...values, 50);
  const max = Math.max(...values, 50);
  // Pad 5% on each side, snap to nearest 5
  let yMin = Math.max(0, Math.floor((min - 5) / 5) * 5);
  let yMax = Math.min(100, Math.ceil((max + 5) / 5) * 5);
  // Ensure at least 20pp visible — flat lines get the 30-70 default treatment
  if (yMax - yMin < 20) {
    yMin = Math.max(0, Math.min(yMin, 30));
    yMax = Math.min(100, Math.max(yMax, 70));
  }
  return [yMin, yMax];
}

// ============================================================
// Main detail component
// ============================================================
export default function TradeDetail({ tradeId, onBack, onDeleted }: Props) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [fullZoom, setFullZoom] = useState(false);

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

  const chartData = useMemo(() => {
    if (!data) return [] as { round: string; roundNum: number; probA: number; deltaPct: number | null }[];
    const map = new Map<number, number>();
    map.set(data.trade.round_executed, 50);
    for (const p of data.probabilityHistory) {
      if (p.round_number === data.trade.round_executed) continue;
      map.set(p.round_number, Number(p.team_a_probability));
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => a - b);
    return sorted.map(([round, pa], idx) => ({
      round: `R${round}`,
      roundNum: round,
      probA: pa,
      deltaPct: idx === 0 ? null : pa - sorted[idx - 1][1],
    }));
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-[60vh] py-12 text-center" style={{ color: TEXT_MUTED }}>
        Loading...
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-[60vh] py-12 text-center" style={{ color: TEXT_MUTED }}>
        Trade not found.
      </div>
    );
  }

  const { trade, players, latestProbability, probabilityHistory, playerPerformance } = data;
  const teamAPlayers = players.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamBPlayers = players.filter((p) => p.receiving_team_id === trade.team_b_id);
  const perfById = new Map(playerPerformance.map((p) => [p.player_id, p]));

  const probA = Number(latestProbability?.team_a_probability ?? 50);
  const probB = Number(latestProbability?.team_b_probability ?? 50);
  const verdict = computeVerdict(probA, probB, trade.team_a_name, trade.team_b_name);
  const aWins = probA >= probB;
  const heroPct = aWins ? probA : probB;
  const heroName = aWins ? trade.team_a_name : trade.team_b_name;

  // Delta vs prior round (for the price tag)
  const sortedHistory = [...probabilityHistory].sort((a, b) => a.round_number - b.round_number);
  let heroDelta: number | null = null;
  if (sortedHistory.length >= 2) {
    const last = sortedHistory[sortedHistory.length - 1];
    const prev = sortedHistory[sortedHistory.length - 2];
    const latestSide = aWins ? Number(last.team_a_probability) : Number(last.team_b_probability);
    const prevSide = aWins ? Number(prev.team_a_probability) : Number(prev.team_b_probability);
    heroDelta = latestSide - prevSide;
  }

  const yDomain: [number, number] = fullZoom ? [0, 100] : autoZoomDomain(chartData.map((d) => d.probA));

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
    <div
      className="-mx-6 -my-8 px-6 py-8 min-h-screen space-y-4"
      style={{ background: BG, color: TEXT }}
    >
      {/* ── Page actions row ──────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm transition-colors"
          style={{ color: TEXT_BODY }}
          onMouseEnter={(e) => (e.currentTarget.style.color = TEXT)}
          onMouseLeave={(e) => (e.currentTarget.style.color = TEXT_BODY)}
        >
          <ArrowLeft size={16} /> Back to all trades
        </button>
        <div className="flex items-center gap-2">
          <ActionButton onClick={() => setEditing(true)} icon={<Pencil size={12} />} label="Edit" />
          <ActionButton
            onClick={handleRecalculate}
            disabled={recalculating}
            icon={<RefreshCw size={12} className={recalculating ? 'animate-spin' : ''} />}
            label="Recalculate"
          />
          <ActionButton
            onClick={handleDelete}
            icon={<Trash2 size={12} />}
            label="Delete"
            danger
          />
        </div>
      </div>

      {/* ── Strip 1: Trade header ─────────────────────────────── */}
      <div
        className="rounded-xl px-6 py-5 flex items-center justify-between gap-6 flex-wrap"
        style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="text-[10px] font-bold tracking-[0.15em] uppercase px-2 py-0.5 rounded"
              style={{ background: 'rgba(163,255,18,0.10)', color: ACCENT }}
            >
              Trade Executed After R{trade.round_executed}
            </span>
            {latestProbability?.round_number != null && (
              <span className="text-[11px]" style={{ color: TEXT_MUTED }}>
                Updated R{latestProbability.round_number}
              </span>
            )}
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold mt-2 leading-tight">
            {trade.team_a_name} <span style={{ color: TEXT_MUTED, fontWeight: 400 }} className="mx-2">⇄</span> {trade.team_b_name}
          </h1>
          <p className="text-sm mt-1" style={{ color: TEXT_MUTED }}>
            {coachByTeamId(trade.team_a_id, trade.team_a_name)}
            <span className="mx-2" style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
            {coachByTeamId(trade.team_b_id, trade.team_b_name)}
          </p>
        </div>
        <VerdictPill verdict={verdict} />
      </div>

      {/* ── Strip 2: The chart (the hero) ─────────────────────── */}
      <div
        className="rounded-xl p-5"
        style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
      >
        {chartData.length < 2 ? (
          <p className="text-sm py-16 text-center" style={{ color: TEXT_MUTED }}>
            No round data yet — probabilities will appear after the next round&apos;s scores are uploaded.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: TEXT_MUTED }}>
                Win Probability
              </h2>
              <button
                onClick={() => setFullZoom((v) => !v)}
                className="text-[11px] transition-colors"
                style={{ color: fullZoom ? ACCENT : TEXT_MUTED }}
              >
                {fullZoom ? 'Auto-zoom' : 'Show 0–100%'}
              </button>
            </div>
            <div className="relative">
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData} margin={{ top: 16, right: 16, bottom: 6, left: 6 }}>
                <defs>
                  <linearGradient id="winFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.20} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="round"
                  tick={{ fontSize: 11, fill: TEXT_MUTED }}
                  axisLine={{ stroke: BORDER }}
                  tickLine={false}
                />
                <YAxis
                  domain={yDomain}
                  ticks={generateTicks(yDomain)}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11, fill: TEXT_MUTED }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  cursor={{ stroke: 'rgba(255,255,255,0.20)', strokeWidth: 1, strokeDasharray: '3 3' }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  content={(props: any) => (
                    <ChartTooltip
                      {...props}
                      teamAName={trade.team_a_name}
                      teamBName={trade.team_b_name}
                    />
                  )}
                />
                {/* 50% coin-flip baseline */}
                <ReferenceLine
                  y={50}
                  stroke="rgba(255,255,255,0.20)"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  label={{
                    value: 'Coin flip',
                    position: 'left',
                    fill: TEXT_MUTED,
                    fontSize: 10,
                    offset: 8,
                  }}
                />
                {/* Trade-executed vertical anchor */}
                <ReferenceLine
                  x={`R${trade.round_executed}`}
                  stroke={ACCENT}
                  strokeOpacity={0.45}
                  strokeDasharray="2 4"
                  label={{
                    value: 'Trade Executed',
                    position: 'insideTopLeft',
                    fill: ACCENT,
                    fontSize: 10,
                    offset: 6,
                  }}
                />
                {/* Area fill under the WHOLE curve, not just one half */}
                <Area
                  type="monotone"
                  dataKey="probA"
                  stroke="none"
                  fill="url(#winFill)"
                  isAnimationActive={false}
                  legendType="none"
                  activeDot={false}
                />
                {/* The probability line */}
                <Line
                  type="monotone"
                  dataKey="probA"
                  stroke={ACCENT}
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
                          <circle cx={cx} cy={cy} r={9} fill={ACCENT} opacity={0.25} />
                          <circle
                            cx={cx}
                            cy={cy}
                            r={5.5}
                            fill={ACCENT}
                            stroke={BG}
                            strokeWidth={2}
                          />
                        </g>
                      );
                    }
                    return <circle key={k} cx={cx} cy={cy} r={3.5} fill={ACCENT} stroke={BG} strokeWidth={1.5} />;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  }) as any}
                  activeDot={{ r: 7, fill: ACCENT, stroke: BG, strokeWidth: 3 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            {/* Price tag — anchored to the top-right of the chart panel.
                Polymarket-style "current price in the corner". */}
            <div className="absolute top-2 right-3 pointer-events-none">
              <PriceTag pct={heroPct} teamName={heroName} delta={heroDelta} />
            </div>
            </div>
          </>
        )}
      </div>

      {/* ── Strip 3: Trade analysis ───────────────────────────── */}
      {(latestProbability?.ai_assessment || trade.context_notes) && (
        <div
          className="rounded-xl p-6"
          style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
        >
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: TEXT_MUTED }}>
              Trade Analysis
            </h2>
            {latestProbability?.round_number != null && (
              <span className="text-[10px]" style={{ color: TEXT_MUTED }}>
                Updated R{latestProbability.round_number}
              </span>
            )}
          </div>
          {latestProbability?.ai_assessment && (
            <AnalysisBody narrative={latestProbability.ai_assessment} />
          )}
          {trade.context_notes && (
            <p
              className="text-sm italic mt-4 pl-4 leading-relaxed"
              style={{
                color: TEXT_BODY,
                borderLeft: `2px solid ${ACCENT}`,
                fontFamily: 'Georgia, "Times New Roman", serif',
              }}
            >
              &ldquo;{trade.context_notes}&rdquo;
            </p>
          )}
        </div>
      )}

      {/* ── Strip 4: Players in the trade (compact rows) ──────── */}
      <div
        className="rounded-xl p-5"
        style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
      >
        <h2 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3" style={{ color: TEXT_MUTED }}>
          Players in the Trade
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <PlayerRowGroup
            heading={`${trade.team_a_name} received`}
            tradePlayers={teamAPlayers}
            perfById={perfById}
          />
          <PlayerRowGroup
            heading={`${trade.team_b_name} received`}
            tradePlayers={teamBPlayers}
            perfById={perfById}
          />
        </div>
      </div>

      {/* ── Strip 5: Round-by-round breakdown (collapsed) ─────── */}
      <div
        className="rounded-xl"
        style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
      >
        <button
          onClick={() => setShowDetails((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors"
          style={{ color: TEXT_BODY }}
          onMouseEnter={(e) => (e.currentTarget.style.color = TEXT)}
          onMouseLeave={(e) => (e.currentTarget.style.color = TEXT_BODY)}
        >
          <span className="text-sm font-medium">
            {showDetails ? 'Hide' : 'Show'} round-by-round breakdown
          </span>
          <ChevronDown
            size={16}
            className={`transition-transform ${showDetails ? 'rotate-180' : ''}`}
          />
        </button>
        {showDetails && (
          <div style={{ borderTop: `1px solid ${BORDER}` }} className="px-5 py-5">
            <DarkScoresGrid
              performance={playerPerformance}
              roundExecuted={trade.round_executed}
              latestRound={latestProbability?.round_number ?? trade.round_executed}
              teamAName={trade.team_a_name}
              teamAId={trade.team_a_id}
              teamBName={trade.team_b_name}
              teamBId={trade.team_b_id}
            />
          </div>
        )}
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
// Header verdict pill
// ============================================================
function VerdictPill({ verdict }: { verdict: Verdict }) {
  const isFlip = verdict.level === 'flip';
  return (
    <div
      className="px-4 py-2 rounded-lg flex items-center gap-2"
      style={{
        background: isFlip ? 'rgba(255,255,255,0.04)' : 'rgba(163,255,18,0.08)',
        border: `1px solid ${isFlip ? BORDER : 'rgba(163,255,18,0.30)'}`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: isFlip ? TEXT_MUTED : ACCENT }}
      />
      <span
        className="text-sm font-semibold whitespace-nowrap"
        style={{ color: isFlip ? TEXT_BODY : ACCENT }}
      >
        {verdict.text}
      </span>
    </div>
  );
}

// ============================================================
// Right-edge price tag (the one fused to the chart line)
// ============================================================
function PriceTag({
  pct,
  teamName,
  delta,
}: {
  pct: number;
  teamName: string;
  delta: number | null;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2 text-right"
      style={{
        background: 'rgba(10,15,28,0.85)',
        border: `1px solid ${BORDER}`,
        backdropFilter: 'blur(4px)',
        minWidth: 100,
      }}
    >
      <div className="text-2xl font-bold leading-none tabular-nums" style={{ color: ACCENT }}>
        {Math.round(pct)}%
      </div>
      <div className="text-[10px] mt-1 font-medium truncate" style={{ color: TEXT_BODY }}>
        {teamName} winning
      </div>
      {delta != null && Math.abs(delta) >= 0.5 && (
        <div
          className="text-[10px] mt-1 flex items-center justify-end gap-0.5 font-semibold tabular-nums"
          style={{ color: delta >= 0 ? ACCENT : STATUS_INJURED }}
        >
          {delta >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// ============================================================
// Chart tooltip — dark, with WoW change
// ============================================================
function ChartTooltip(props: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  teamAName: string;
  teamBName: string;
}) {
  if (!props.active || !props.payload?.length) return null;
  const p = props.payload[0]?.payload as { probA: number; deltaPct: number | null; round: string } | undefined;
  if (!p) return null;
  const winName = p.probA >= 50 ? props.teamAName : props.teamBName;
  const winPct = p.probA >= 50 ? p.probA : 100 - p.probA;
  return (
    <div
      style={{
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: '8px 10px',
        minWidth: 130,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: TEXT_MUTED }}>
        Round {String(p.round).replace('R', '')}
      </div>
      <div className="text-sm font-semibold" style={{ color: ACCENT }}>
        {Math.round(winPct)}% {winName}
      </div>
      {p.deltaPct != null && Math.abs(p.deltaPct) >= 0.1 && (
        <div
          className="text-[10px] mt-0.5 tabular-nums"
          style={{ color: p.deltaPct >= 0 ? ACCENT : STATUS_INJURED }}
        >
          {p.deltaPct >= 0 ? '+' : ''}
          {p.deltaPct.toFixed(1)}% vs prev round
        </div>
      )}
    </div>
  );
}

// ============================================================
// Trade analysis body — splits AI narrative into headline + body
// ============================================================
function AnalysisBody({ narrative }: { narrative: string }) {
  const trimmed = narrative.trim();
  // Treat first sentence as the headline
  const match = trimmed.match(/^[^.!?]+[.!?]/);
  const headline = match ? match[0].trim() : trimmed;
  const rest = match ? trimmed.slice(match[0].length).trim() : '';
  return (
    <>
      <p className="text-lg font-medium leading-snug" style={{ color: TEXT }}>
        {headline}
      </p>
      {rest && (
        <p className="text-sm mt-2 leading-relaxed" style={{ color: TEXT_BODY }}>
          {rest}
        </p>
      )}
    </>
  );
}

// ============================================================
// Player row group (one column — "Team X received")
// ============================================================
function PlayerRowGroup({
  heading,
  tradePlayers,
  perfById,
}: {
  heading: string;
  tradePlayers: TradePlayer[];
  perfById: Map<number, PlayerPerformance>;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: TEXT_MUTED }}>
        {heading}
      </p>
      <div className="space-y-1">
        {tradePlayers.length === 0 && (
          <p className="text-xs italic" style={{ color: TEXT_MUTED }}>—</p>
        )}
        {tradePlayers.map((tp) => {
          const perf = perfById.get(tp.player_id);
          return <PlayerRow key={tp.id} tradePlayer={tp} performance={perf} />;
        })}
      </div>
    </div>
  );
}

function PlayerRow({
  tradePlayer,
  performance,
}: {
  tradePlayer: TradePlayer;
  performance: PlayerPerformance | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const injured = performance?.injured ?? false;
  const pos = performance
    ? displayPosition(performance)
    : cleanPositionDisplay(tradePlayer.raw_position) ?? '—';
  const pre = tradePlayer.pre_trade_avg;
  const post = performance?.post_trade_avg ?? 0;
  const hasPost = (performance?.rounds_played ?? 0) > 0;
  const delta = hasPost && pre != null ? post - pre : null;

  const statusColor = injured ? STATUS_INJURED : ACCENT;
  const statusLabel = injured ? 'Injured' : 'Active';

  // Inline mini-trajectory data when expanded
  const traj = useMemo(() => {
    if (!performance) return [] as { round: number; pts: number | null }[];
    const all: { round: number; pts: number | null }[] = [
      ...(performance.pre_trade_round_scores ?? []).map((s) => ({ round: s.round, pts: s.points })),
      ...performance.round_scores.map((s) => ({ round: s.round, pts: s.points })),
    ];
    return all.sort((a, b) => a.round - b.round);
  }, [performance]);

  return (
    <div
      className="rounded-md transition-colors"
      style={{
        background: expanded ? 'rgba(255,255,255,0.03)' : 'transparent',
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-2 py-2 text-left"
      >
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: statusColor }}
          title={statusLabel}
        />
        <span className="font-medium text-sm truncate flex-1" style={{ color: TEXT }}>
          {tradePlayer.player_name}
        </span>
        <span className="text-[10px] tabular-nums shrink-0" style={{ color: TEXT_MUTED }}>
          {pos}
        </span>
        <span className="text-xs tabular-nums shrink-0" style={{ color: TEXT_BODY }}>
          {pre != null && pre > 0 ? pre.toFixed(0) : '—'}{' '}
          <span style={{ color: TEXT_MUTED }}>→</span>{' '}
          <span style={{ color: TEXT }}>{hasPost ? post.toFixed(0) : '—'}</span>
          {delta != null && (
            <span
              className="ml-1.5"
              style={{ color: delta >= 0 ? ACCENT : STATUS_INJURED }}
            >
              ({delta >= 0 ? '+' : ''}
              {delta.toFixed(0)})
            </span>
          )}
        </span>
      </button>
      {expanded && traj.length > 0 && (
        <MiniTrajectory traj={traj} roundExecuted={tradePlayer.player_id ? undefined : undefined} performance={performance} />
      )}
    </div>
  );
}

function MiniTrajectory({
  traj,
  performance,
}: {
  traj: { round: number; pts: number | null }[];
  roundExecuted?: number;
  performance: PlayerPerformance | undefined;
}) {
  if (!performance) return null;
  const baseline = baselineForPerformance(performance);
  return (
    <div className="px-2 pb-3 grid grid-flow-col auto-cols-fr gap-1">
      {traj.map((s) => {
        const cell = scoreCellStyle(s.pts, baseline);
        return (
          <div
            key={s.round}
            className="rounded text-center py-1.5 text-[11px] tabular-nums"
            style={{
              background: cell.bg,
              color: cell.color,
              border: `1px solid ${cell.border}`,
            }}
            title={`R${s.round}`}
          >
            <div className="text-[9px] opacity-60 leading-none mb-0.5">R{s.round}</div>
            <div className="font-semibold leading-none">
              {s.pts == null ? 'DNP' : s.pts}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Action button (Edit / Recalc / Delete)
// ============================================================
function ActionButton({
  onClick,
  icon,
  label,
  disabled,
  danger,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${BORDER}`,
        color: danger ? STATUS_INJURED : TEXT_BODY,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
        if (!danger) e.currentTarget.style.color = TEXT;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        if (!danger) e.currentTarget.style.color = TEXT_BODY;
      }}
    >
      {icon} {label}
    </button>
  );
}

// ============================================================
// Helpers
// ============================================================
function generateTicks([min, max]: [number, number]): number[] {
  const range = max - min;
  // Aim for 4-6 ticks
  const step = range <= 20 ? 5 : range <= 40 ? 10 : 25;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  // Always include 50 if it's in range
  if (50 >= min && 50 <= max && !ticks.includes(50)) ticks.push(50);
  return ticks.sort((a, b) => a - b);
}

function coachByTeamId(_id: number, fallback: string): string {
  // Use client-side lookup against TEAMS — kept in a separate import to avoid
  // circular issues. We import inline-ish here.
  // Lazy require pattern; defer to module-scoped constant.
  return TEAM_COACH_LOOKUP[_id] ?? fallback;
}

// Filled at module init to avoid re-iterating TEAMS on every render
import { TEAMS } from '@/lib/constants';
const TEAM_COACH_LOOKUP: Record<number, string> = Object.fromEntries(
  TEAMS.map((t) => [t.team_id, t.coach])
);

function scoreCellStyle(
  pts: number | null,
  baseline: number
): { bg: string; color: string; border: string } {
  if (pts == null) {
    return {
      bg: 'rgba(255,255,255,0.02)',
      color: TEXT_MUTED,
      border: 'rgba(255,255,255,0.04)',
    };
  }
  const diff = pts - baseline;
  if (diff >= 20) return { bg: 'rgba(163,255,18,0.18)', color: ACCENT, border: 'rgba(163,255,18,0.30)' };
  if (diff >= 5) return { bg: 'rgba(163,255,18,0.08)', color: ACCENT, border: 'rgba(163,255,18,0.18)' };
  if (diff <= -20) return { bg: 'rgba(226,75,74,0.15)', color: STATUS_INJURED, border: 'rgba(226,75,74,0.30)' };
  if (diff <= -5) return { bg: 'rgba(226,75,74,0.08)', color: '#F0B0AF', border: 'rgba(226,75,74,0.18)' };
  return { bg: 'rgba(255,255,255,0.04)', color: TEXT_BODY, border: 'rgba(255,255,255,0.06)' };
}

// ============================================================
// Dark-themed scores grid (replaces the old white-table version)
// ============================================================
function DarkScoresGrid({
  performance,
  roundExecuted,
  latestRound,
  teamAName,
  teamAId,
  teamBName,
  teamBId,
}: {
  performance: PlayerPerformance[];
  roundExecuted: number;
  latestRound: number;
  teamAName: string;
  teamAId: number;
  teamBName: string;
  teamBId: number;
}) {
  if (performance.length === 0) {
    return (
      <p className="text-sm text-center py-4" style={{ color: TEXT_MUTED }}>
        No players found for this trade.
      </p>
    );
  }

  // Pre/post round axes
  const preRoundsSet = new Set<number>();
  for (const p of performance) {
    for (const s of p.pre_trade_round_scores ?? []) {
      if (s.round <= roundExecuted) preRoundsSet.add(s.round);
    }
  }
  const preRounds = Array.from(preRoundsSet).sort((a, b) => a - b);
  const postRounds: number[] = [];
  for (let r = roundExecuted + 1; r <= latestRound; r++) postRounds.push(r);

  const sideA = performance.filter((p) => p.receiving_team_id === teamAId);
  const sideB = performance.filter((p) => p.receiving_team_id === teamBId);

  const renderRow = (p: PlayerPerformance) => {
    const baseline = baselineForPerformance(p);
    const preMap = new Map<number, number | null>();
    for (const s of p.pre_trade_round_scores ?? []) preMap.set(s.round, s.points);
    const postMap = new Map<number, number | null>();
    for (const s of p.round_scores) postMap.set(s.round, s.points);

    const prePlayed = (p.pre_trade_round_scores ?? []).filter((s) => s.points != null);
    const preAvg = prePlayed.length > 0 ? prePlayed.reduce((a, s) => a + (s.points ?? 0), 0) / prePlayed.length : null;
    const postPlayed = p.round_scores.filter((s) => s.points != null);
    const postAvg = postPlayed.length > 0 ? postPlayed.reduce((a, s) => a + (s.points ?? 0), 0) / postPlayed.length : null;

    return (
      <tr key={p.player_id} style={{ borderTop: `1px solid ${BORDER}` }}>
        <td className="py-2 pr-3 whitespace-nowrap text-sm">
          <span className="font-medium" style={{ color: TEXT }}>
            {p.player_name}
          </span>{' '}
          <span className="text-[11px] ml-1" style={{ color: TEXT_MUTED }}>
            ({displayPosition(p)})
          </span>
        </td>
        {preRounds.map((r) => {
          const pts = preMap.get(r);
          return (
            <td key={`pre-${r}`} className="px-1 py-1 text-center">
              <ScoreCell pts={pts === undefined ? null : pts} hasRound={preMap.has(r)} baseline={baseline} />
            </td>
          );
        })}
        <td className="px-2 py-2 text-right text-xs tabular-nums" style={{ color: TEXT_MUTED, borderLeft: `1px solid ${BORDER}` }}>
          {preAvg != null ? preAvg.toFixed(0) : '—'}
        </td>
        <td className="px-1" style={{ width: 4 }}>
          <div className="h-7 w-1 mx-auto rounded-full" style={{ background: ACCENT }} />
        </td>
        {postRounds.map((r) => {
          const pts = postMap.get(r);
          return (
            <td key={`post-${r}`} className="px-1 py-1 text-center">
              <ScoreCell pts={pts === undefined ? null : pts} hasRound={postMap.has(r)} baseline={baseline} />
            </td>
          );
        })}
        <td className="pl-3 py-2 text-right text-sm font-semibold tabular-nums" style={{ color: TEXT }}>
          {postAvg != null ? postAvg.toFixed(0) : '—'}
        </td>
      </tr>
    );
  };

  const colSpan = 1 + preRounds.length + 1 + 1 + postRounds.length + 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
            <th className="py-1 pr-3 text-left font-medium">Player</th>
            {preRounds.length > 0 && (
              <th colSpan={preRounds.length} className="py-1 px-1 text-center font-semibold">
                Before
              </th>
            )}
            <th className="py-1 px-2 text-center font-medium" style={{ borderLeft: `1px solid ${BORDER}` }}>
              Pre
            </th>
            <th className="px-1" />
            {postRounds.length > 0 && (
              <th colSpan={postRounds.length} className="py-1 px-1 text-center font-semibold">
                After
              </th>
            )}
            <th className="py-1 pl-3 text-right font-medium">Post</th>
          </tr>
          <tr className="text-[10px]" style={{ color: TEXT_MUTED, borderBottom: `1px solid ${BORDER}` }}>
            <th className="py-1 pr-3" />
            {preRounds.map((r) => (
              <th key={`hpre-${r}`} className="py-1 px-1 text-center font-normal">R{r}</th>
            ))}
            <th className="py-1 px-2" style={{ borderLeft: `1px solid ${BORDER}` }} />
            <th className="px-1" />
            {postRounds.map((r) => (
              <th key={`hpost-${r}`} className="py-1 px-1 text-center font-normal">R{r}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={colSpan} className="pt-3 pb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: ACCENT }}>
                ◆ {teamAName} received
              </span>
            </td>
          </tr>
          {sideA.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="pl-3 pb-2 text-xs italic" style={{ color: TEXT_MUTED }}>
                —
              </td>
            </tr>
          )}
          {sideA.map(renderRow)}

          <tr>
            <td colSpan={colSpan} className="pt-4 pb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: ACCENT }}>
                ◆ {teamBName} received
              </span>
            </td>
          </tr>
          {sideB.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="pl-3 pb-2 text-xs italic" style={{ color: TEXT_MUTED }}>
                —
              </td>
            </tr>
          )}
          {sideB.map(renderRow)}
        </tbody>
      </table>
      {postRounds.length === 0 && (
        <p className="text-xs italic mt-3" style={{ color: TEXT_MUTED }}>
          No post-trade rounds played yet — scores will fill in once R{roundExecuted + 1} is uploaded.
        </p>
      )}
    </div>
  );
}

function ScoreCell({
  pts,
  hasRound,
  baseline,
}: {
  pts: number | null;
  hasRound: boolean;
  baseline: number;
}) {
  if (!hasRound) {
    return (
      <span
        className="inline-block min-w-[2.25rem] px-1.5 py-0.5 rounded text-xs tabular-nums"
        style={{ color: TEXT_MUTED }}
      >
        —
      </span>
    );
  }
  const cell = scoreCellStyle(pts, baseline);
  return (
    <span
      className="inline-block min-w-[2.25rem] px-1.5 py-0.5 rounded text-xs tabular-nums font-medium"
      style={{
        background: cell.bg,
        color: cell.color,
        border: `1px solid ${cell.border}`,
      }}
    >
      {pts == null ? 'DNP' : pts}
    </span>
  );
}
