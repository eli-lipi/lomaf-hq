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
  ReferenceArea,
} from 'recharts';
import { cleanPositionDisplay } from '@/lib/trades/positions';
import {
  snap5,
  verdictFor,
  playerVerdictFor,
  colorForTeam,
  buildDisplayLabels,
} from '@/lib/trades/scale';
import {
  getTradeColorPair,
  getContrastingTextColor,
  hexWithOpacity,
} from '@/lib/team-colors';
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

// Verdict logic now lives in '@/lib/trades/scale' (verdictFor).
// Y-axis is fixed −100..+100; auto-zoom is gone (snapping makes it unnecessary).

// ============================================================
// Main detail component
// ============================================================
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

  // v2 chart data — signed advantage on the ±100 scale, polarized to
  // positive_team_id. Falls back to deriving from team_a_probability for
  // legacy rows that haven't been re-computed yet.
  const chartData = useMemo(() => {
    if (!data) return [] as { round: string; roundNum: number; advantage: number; deltaPct: number | null }[];
    const positiveIsA = data.trade.positive_team_id == null
      ? true
      : data.trade.positive_team_id === data.trade.team_a_id;
    const advFromRow = (p: TradeProbability): number => {
      if (p.advantage != null) return snap5(Number(p.advantage));
      // Legacy fallback: derive from team_a_probability (0-100 → ±100)
      const aEdge = (Number(p.team_a_probability) - 50) * 2;
      return snap5(positiveIsA ? aEdge : -aEdge);
    };
    const map = new Map<number, number>();
    map.set(data.trade.round_executed, 0); // anchor at neutral
    for (const p of data.probabilityHistory) {
      if (p.round_number === data.trade.round_executed) continue;
      map.set(p.round_number, advFromRow(p));
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => a - b);
    return sorted.map(([round, adv], idx) => ({
      round: `R${round}`,
      roundNum: round,
      advantage: adv,
      // Delta vs prior round, computed between snapped values per spec.
      deltaPct: idx === 0 ? null : adv - sorted[idx - 1][1],
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

  // Per-trade display labels — surnames, with first-initial disambiguation
  // when surnames collide (Humphries vs Humphrey).
  const displayLabels = buildDisplayLabels(
    players.map((p) => ({ player_id: p.player_id, player_name: p.player_name }))
  );

  // v5 — per-trade colour pair pulled from each team's permanent identity.
  // The chart, player headlines, table spines, etc. all draw from this.
  const colorPair = getTradeColorPair(trade.positive_team_id, trade.negative_team_id);
  const colorPositive = colorPair.positive;
  const colorNegative = colorPair.negative;

  // v2 — work in signed ±100 advantage. Polarity is locked at trade time on
  // `trade.positive_team_id`. Legacy rows fall back to assuming team A is
  // positive.
  const positiveIsA =
    trade.positive_team_id == null ? true : trade.positive_team_id === trade.team_a_id;
  const positiveTeamName = positiveIsA ? trade.team_a_name : trade.team_b_name;
  const negativeTeamName = positiveIsA ? trade.team_b_name : trade.team_a_name;

  // Latest snapped advantage. Uses the stored `advantage` field; falls back
  // to deriving from team_a_probability for legacy rows.
  const advantage: number = (() => {
    if (latestProbability?.advantage != null) return snap5(Number(latestProbability.advantage));
    const aEdge = (snap5(Number(latestProbability?.team_a_probability ?? 50)) - 50) * 2;
    return positiveIsA ? aEdge : -aEdge;
  })();

  const verdict = verdictFor(advantage, positiveTeamName, negativeTeamName);
  const winningTeamName = advantage >= 0 ? positiveTeamName : negativeTeamName;

  // Delta vs prior round — computed between snapped values per spec, so a
  // round where nothing changed shows 0% (no fake movement).
  let heroDelta: number | null = null;
  if (chartData.length >= 2) {
    heroDelta = chartData[chartData.length - 1].deltaPct ?? null;
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

      {/* ── Tier-0: thin metadata strip ───────────────────────── */}
      <MetadataStrip trade={trade} latestProbability={latestProbability} />

      {/* ── PLAYER HEADLINE — surnames front and centre ───────── */}
      <PlayerHeadline
        trade={trade}
        teamAPlayers={teamAPlayers}
        teamBPlayers={teamBPlayers}
        verdict={verdict}
        winningTeamName={winningTeamName}
        advantage={advantage}
      />

      {/* ── Tier-1: the chart, FULL BLEED, no card ────────────── */}
      <div className="px-1">
        {chartData.length < 2 ? (
          <p className="text-sm py-16 text-center" style={{ color: TEXT_MUTED }}>
            No round data yet — probabilities will appear after the next round&apos;s scores are uploaded.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.15em] flex items-center gap-1.5" style={{ color: TEXT_MUTED }}>
                Win Probability
                <InfoTip>
                  Performance vs. each player&apos;s expected average (~70%) blended with availability vs. expected games (~30%). Snapped to nearest 5%. Polarity locked at trade execution to whichever team had the better ladder position.
                </InfoTip>
              </h2>
            </div>
            <div className="relative">
              {/* Trade Executed flag — sits ABOVE the chart on the dashed line */}
              <TradeExecutedFlag chartData={chartData} executedRound={trade.round_executed} />
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={chartData} margin={{ top: 30, right: 16, bottom: 6, left: 8 }}>
                  <defs>
                    {/* Vertical gradient — green above 0%, cyan below. Hard stop at y=0 (50% of −100..+100 axis). */}
                    <linearGradient id="lineColorSplit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colorPositive} />
                      <stop offset="50%" stopColor={colorPositive} />
                      <stop offset="50%" stopColor={colorNegative} />
                      <stop offset="100%" stopColor={colorNegative} />
                    </linearGradient>
                    <linearGradient id="areaFillSplit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colorPositive} stopOpacity={0.18} />
                      <stop offset="50%" stopColor={colorPositive} stopOpacity={0.04} />
                      <stop offset="50%" stopColor={colorNegative} stopOpacity={0.04} />
                      <stop offset="100%" stopColor={colorNegative} stopOpacity={0.18} />
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
                    domain={[-100, 100]}
                    ticks={[-100, -50, 0, 50, 100]}
                    tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`}
                    tick={{ fontSize: 11, fill: TEXT_MUTED }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip
                    cursor={{ stroke: 'rgba(255,255,255,0.20)', strokeWidth: 1, strokeDasharray: '3 3' }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={(props: any) => (
                      <ChartTooltip
                        {...props}
                        positiveTeamName={positiveTeamName}
                        negativeTeamName={negativeTeamName}
                      />
                    )}
                  />
                  {/* Vertical anchor — no label here, the flag above handles it */}
                  <ReferenceLine
                    x={`R${trade.round_executed}`}
                    stroke="rgba(255,255,255,0.30)"
                    strokeDasharray="2 4"
                  />
                  {/* Wash baseline — solid */}
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} />
                  {/* Area fill — gradient handles the green-above / cyan-below split */}
                  <Area
                    type="monotone"
                    dataKey="advantage"
                    stroke="none"
                    fill="url(#areaFillSplit)"
                    baseValue={0}
                    isAnimationActive={false}
                    legendType="none"
                    activeDot={false}
                  />
                  {/* The advantage line — gradient stroke = green above 0, cyan below */}
                  <Line
                    type="monotone"
                    dataKey="advantage"
                    stroke="url(#lineColorSplit)"
                    strokeWidth={2.5}
                    dot={((dotProps: Record<string, unknown>) => {
                      const cx = dotProps.cx as number | undefined;
                      const cy = dotProps.cy as number | undefined;
                      const index = dotProps.index as number | undefined;
                      const payload = dotProps.payload as { advantage?: number } | undefined;
                      const k = String(dotProps.key ?? index ?? '');
                      if (cx == null || cy == null) return <g key={k} />;
                      const dotColor = (payload?.advantage ?? 0) >= 0 ? colorPositive : colorNegative;
                      const isLast = index === chartData.length - 1;
                      if (isLast) {
                        return (
                          <g key={k}>
                            <circle cx={cx} cy={cy} r={9} fill={dotColor} opacity={0.25} />
                            <circle cx={cx} cy={cy} r={5.5} fill={dotColor} stroke={BG} strokeWidth={2} />
                          </g>
                        );
                      }
                      return <circle key={k} cx={cx} cy={cy} r={3.5} fill={dotColor} stroke={BG} strokeWidth={1.5} />;
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }) as any}
                    activeDot={{ r: 7, fill: ACCENT, stroke: BG, strokeWidth: 3 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>

              {/* Team labels — once at the extremes, not at every tick */}
              <div
                className="absolute pointer-events-none text-[11px] font-medium uppercase tracking-wider"
                style={{ top: 36, right: 24, color: colorPositive }}
              >
                ↑ {positiveTeamName}
              </div>
              <div
                className="absolute pointer-events-none text-[11px] font-medium uppercase tracking-wider"
                style={{ bottom: 32, right: 24, color: colorNegative }}
              >
                ↓ {negativeTeamName}
              </div>

              {/* Price tag — top-right of chart, coloured by current side */}
              <div className="absolute top-8 right-3 pointer-events-none">
                <PriceTag
                  advantage={advantage}
                  winningTeamName={winningTeamName}
                  delta={heroDelta}
                  colorPositive={colorPositive}
                  colorNegative={colorNegative}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Tier-2: Player tables — vertical stacked, team-colour spines ─────
          v5: positive-side team's table sits on top, negative below. Each
          gets a 6px team-colour spine on the left edge (inset box-shadow so
          content stays flush). The "RECEIVED" header sits inside the card. */}
      {(() => {
        const positiveIsA =
          trade.positive_team_id == null ? true : trade.positive_team_id === trade.team_a_id;
        const positivePlayers = positiveIsA ? teamAPlayers : teamBPlayers;
        const negativePlayers = positiveIsA ? teamBPlayers : teamAPlayers;
        const positiveTeamId = positiveIsA ? trade.team_a_id : trade.team_b_id;
        const negativeTeamId = positiveIsA ? trade.team_b_id : trade.team_a_id;
        const positiveTN = positiveIsA ? trade.team_a_name : trade.team_b_name;
        const negativeTN = positiveIsA ? trade.team_b_name : trade.team_a_name;
        return (
          <div className="flex flex-col gap-4 mt-6">
            <PlayerTableSection
              title={`${positiveTN} received`}
              tradePlayers={positivePlayers}
              perfById={perfById}
              teamColor={colorPositive}
              teamId={positiveTeamId}
              displayLabels={displayLabels}
            />
            <PlayerTableSection
              title={`${negativeTN} received`}
              tradePlayers={negativePlayers}
              perfById={perfById}
              teamColor={colorNegative}
              teamId={negativeTeamId}
              displayLabels={displayLabels}
            />
          </div>
        );
      })()}

      {/* ── Tier-3: Trade analysis — moved BELOW the tables in v5.
          Reads as a synthesis of the data above it, not a teaser. */}
      {(latestProbability?.ai_assessment || trade.context_notes) && (
        <div className="px-6 pt-4 mt-2">
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
                // Pull-quote left border in the trade-logger's team colour.
                // Lipi logs every LOMAF trade — anchor to LIPI's identity.
                borderLeft: `2px solid ${colorForTeam(3194003, trade.positive_team_id)}`,
                fontFamily: 'Georgia, "Times New Roman", serif',
              }}
            >
              &ldquo;{trade.context_notes}&rdquo;
            </p>
          )}
        </div>
      )}

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
// Tier-0 — thin metadata strip at the very top
// ============================================================
function MetadataStrip({
  trade,
  latestProbability,
}: {
  trade: Trade;
  latestProbability: TradeProbability | null;
}) {
  const coachA = coachByTeamId(trade.team_a_id, '');
  const coachB = coachByTeamId(trade.team_b_id, '');
  return (
    <div
      className="text-[11px] uppercase tracking-[0.12em] flex items-center gap-x-3 gap-y-1 flex-wrap pt-1"
      style={{ color: TEXT_MUTED }}
    >
      <span>Trade Executed After R{trade.round_executed}</span>
      {latestProbability?.round_number != null && (
        <>
          <span style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>
          <span>Updated R{latestProbability.round_number}</span>
        </>
      )}
      <span style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>
      <span>
        {trade.team_a_name}
        {trade.team_a_ladder_at_trade != null && (
          <span className="normal-case ml-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            ({ordinal(trade.team_a_ladder_at_trade)})
          </span>
        )}
        {coachA && <span className="normal-case ml-1.5" style={{ color: 'rgba(255,255,255,0.40)' }}>· {coachA}</span>}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.18)' }}>⇄</span>
      <span>
        {trade.team_b_name}
        {trade.team_b_ladder_at_trade != null && (
          <span className="normal-case ml-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            ({ordinal(trade.team_b_ladder_at_trade)})
          </span>
        )}
        {coachB && <span className="normal-case ml-1.5" style={{ color: 'rgba(255,255,255,0.40)' }}>· {coachB}</span>}
      </span>
    </div>
  );
}

// ============================================================
// Player headline — surnames front and centre
// ============================================================
function PlayerHeadline({
  trade,
  teamAPlayers,
  teamBPlayers,
  verdict,
  winningTeamName,
  advantage,
}: {
  trade: Trade;
  teamAPlayers: TradePlayer[];
  teamBPlayers: TradePlayer[];
  verdict: { level: string; text: string; isFlip: boolean };
  winningTeamName: string;
  advantage: number;
}) {
  const allPlayers = [...teamAPlayers, ...teamBPlayers];
  const labels = buildDisplayLabels(
    allPlayers.map((p) => ({ player_id: p.player_id, player_name: p.player_name }))
  );
  const colorA = colorForTeam(trade.team_a_id, trade.positive_team_id);
  const colorB = colorForTeam(trade.team_b_id, trade.positive_team_id);

  // Type sizing — scales down as we add players
  const totalPlayers = allPlayers.length;
  const isOneForOne = teamAPlayers.length === 1 && teamBPlayers.length === 1;
  // Pick a font size class based on player count
  const surnameSize = isOneForOne
    ? 'text-[44px] md:text-[60px]'
    : totalPlayers <= 4
      ? 'text-[28px] md:text-[36px]'
      : 'text-[22px] md:text-[28px]';
  const arrowSize = isOneForOne ? 'text-[28px] md:text-[36px]' : 'text-[20px] md:text-[26px]';

  return (
    <div className="mt-2 mb-2">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Names — for 1-for-1 we render side-by-side with arrow.
            For multi-player we stack rows top/bottom with arrow between. */}
        {isOneForOne ? (
          <div className="flex items-baseline gap-4 flex-wrap">
            <SinglePlayerCluster player={teamAPlayers[0]} color={colorA} labels={labels} size={surnameSize} />
            <span className={`${arrowSize}`} style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 300 }}>⇄</span>
            <SinglePlayerCluster player={teamBPlayers[0]} color={colorB} labels={labels} size={surnameSize} />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <PlayerRowHeadline
              players={teamAPlayers}
              color={colorA}
              receivingTeam={trade.team_a_name}
              labels={labels}
              size={surnameSize}
            />
            <span className={`${arrowSize} my-1`} style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 300 }}>⇅</span>
            <PlayerRowHeadline
              players={teamBPlayers}
              color={colorB}
              receivingTeam={trade.team_b_name}
              labels={labels}
              size={surnameSize}
            />
          </div>
        )}
        {/* Verdict pill — coloured by the winning side */}
        <VerdictPillV3
          verdict={verdict}
          winnerColor={
            verdict.isFlip
              ? null
              : advantage >= 0
                ? colorForTeam(trade.positive_team_id ?? trade.team_a_id, trade.positive_team_id)
                : colorForTeam(trade.negative_team_id ?? trade.team_b_id, trade.positive_team_id)
          }
        />
      </div>
      {/* Subtitle row showing receiving teams (for 1-for-1) */}
      {isOneForOne && (
        <p className="text-[12px] mt-2" style={{ color: TEXT_MUTED }}>
          <span style={{ color: colorA }}>{trade.team_a_name} received</span>
          <span className="mx-3" style={{ color: 'rgba(255,255,255,0.18)' }}>|</span>
          <span style={{ color: colorB }}>{trade.team_b_name} received</span>
        </p>
      )}
      {/* Optional helper line for multi-player shows the winner cleanly */}
      {!isOneForOne && (
        <p className="text-[12px] mt-2" style={{ color: TEXT_MUTED }}>
          {winningTeamName !== '' ? `Currently: ${verdict.text}` : ''}
        </p>
      )}
    </div>
  );
}

function SinglePlayerCluster({
  player,
  color,
  labels,
  size,
}: {
  player: TradePlayer;
  color: string;
  labels: Map<number, string>;
  size: string;
}) {
  const pos = cleanPositionDisplay(player.raw_position) ?? '—';
  const label = labels.get(player.player_id) ?? player.player_name;
  return (
    <div className="flex flex-col items-start">
      <span className={`${size} font-medium leading-none`} style={{ color }}>
        {label}
      </span>
      <span
        className="text-[11px] uppercase tracking-[0.15em] mt-1.5"
        style={{ color: hexWithOpacity(color, 0.5) }}
      >
        {pos}
      </span>
    </div>
  );
}

function PlayerRowHeadline({
  players,
  color,
  receivingTeam,
  labels,
  size,
}: {
  players: TradePlayer[];
  color: string;
  receivingTeam: string;
  labels: Map<number, string>;
  size: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-x-2.5 flex-wrap">
        {players.map((p, i) => {
          const label = labels.get(p.player_id) ?? p.player_name;
          const pos = cleanPositionDisplay(p.raw_position);
          return (
            <span key={p.id} className={`${size} font-medium leading-tight`} style={{ color }}>
              {label}
              {pos && (
                <span
                  className="text-[11px] ml-1 uppercase tracking-wider"
                  style={{ color: hexWithOpacity(color, 0.5) }}
                >
                  ({pos})
                </span>
              )}
              {i < players.length - 1 && (
                <span style={{ color: 'rgba(255,255,255,0.18)', marginLeft: 8, marginRight: 0 }}>·</span>
              )}
            </span>
          );
        })}
      </div>
      <p className="text-[10px] uppercase tracking-[0.18em] mt-0.5" style={{ color }}>
        ↑ {receivingTeam} received
      </p>
    </div>
  );
}

/** v3 verdict pill — filled by winner colour, dark text on accent, white on flip. */
function VerdictPillV3({
  verdict,
  winnerColor,
}: {
  verdict: { level: string; text: string; isFlip: boolean };
  winnerColor: string | null;
}) {
  if (verdict.isFlip || winnerColor == null) {
    return (
      <div
        className="px-4 py-2 rounded-full whitespace-nowrap text-sm font-semibold"
        style={{
          background: 'rgba(255,255,255,0.08)',
          border: `1px solid ${BORDER}`,
          color: TEXT,
        }}
      >
        {verdict.text}
      </div>
    );
  }
  // Pick readable text on the team-coloured pill background — light teams
  // (lime, mustard, sage) get dark navy text; darker teams get white.
  const fg = readableTextOn(winnerColor);
  return (
    <div
      className="px-4 py-2 rounded-full whitespace-nowrap text-sm font-bold"
      style={{
        background: winnerColor,
        color: fg,
      }}
    >
      {verdict.text}
    </div>
  );
}

// ============================================================
// Trade Executed flag — sits ABOVE the chart's top edge on the dashed line
// ============================================================
function TradeExecutedFlag({
  chartData,
  executedRound,
}: {
  chartData: { round: string; roundNum: number }[];
  executedRound: number;
}) {
  // Find the index of the executed round in the chart data
  const idx = chartData.findIndex((d) => d.roundNum === executedRound);
  if (idx < 0 || chartData.length < 2) return null;
  // Approximate horizontal position. The chart has left margin 8 + Y-axis ~50px,
  // total render width is responsive. We approximate using percentage of inner data width.
  const innerLeft = 58; // px — left margin + y-axis width
  const innerRight = 24;
  const fraction = (idx) / Math.max(chartData.length - 1, 1);
  return (
    <div
      className="absolute top-0 pointer-events-none flex flex-col items-center"
      style={{
        left: `calc(${innerLeft}px + (100% - ${innerLeft + innerRight}px) * ${fraction})`,
        transform: 'translateX(-50%)',
        zIndex: 5,
      }}
    >
      <span
        className="text-[10px] font-bold uppercase tracking-[0.10em] px-1.5 py-0.5 rounded"
        style={{ background: BG, color: TEXT, border: `1px solid ${BORDER}` }}
      >
        Trade Executed
      </span>
    </div>
  );
}

// ============================================================
// Header verdict pill (legacy — kept in case anything still imports it)
// ============================================================
function VerdictPill({ verdict }: { verdict: { level: string; text: string; isFlip: boolean } }) {
  const isFlip = verdict.isFlip;
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
// Right-edge price tag — signed ±100 advantage with team colour
// ============================================================
function PriceTag({
  advantage,
  winningTeamName,
  delta,
  colorPositive,
  colorNegative,
}: {
  advantage: number;
  winningTeamName: string;
  delta: number | null;
  colorPositive: string;
  colorNegative: string;
}) {
  // Wash state — neither side leading
  if (advantage === 0) {
    return (
      <div
        className="rounded-lg px-3 py-2 text-right"
        style={{
          background: 'rgba(10,15,28,0.85)',
          border: `1px solid ${BORDER}`,
          backdropFilter: 'blur(4px)',
          minWidth: 110,
        }}
      >
        <div className="text-xl font-bold leading-none tracking-wider" style={{ color: TEXT }}>
          WASH
        </div>
        <div className="text-[10px] mt-1.5" style={{ color: TEXT_MUTED }}>
          neither side leading
        </div>
      </div>
    );
  }

  const winnerColor = advantage > 0 ? colorPositive : colorNegative;
  const sign = advantage > 0 ? '+' : '';
  // Delta only shown if it's non-zero AFTER snapping (per spec — suppress fake noise)
  const showDelta = delta != null && delta !== 0;
  // Delta colour: positive-team's colour for upward movement, negative-team's
  // for downward. Never red — that was the contradictory-pill bug.
  const deltaColor = showDelta && delta! > 0 ? colorPositive : colorNegative;

  return (
    <div
      className="rounded-lg px-3 py-2 text-right"
      style={{
        background: 'rgba(10,15,28,0.85)',
        border: `1px solid ${BORDER}`,
        backdropFilter: 'blur(4px)',
        minWidth: 120,
      }}
    >
      <div className="text-2xl font-bold leading-none tabular-nums" style={{ color: winnerColor }}>
        {sign}
        {advantage}%
      </div>
      <div
        className="text-[11px] mt-1 font-semibold leading-tight truncate"
        style={{ color: winnerColor }}
      >
        {winningTeamName}
      </div>
      <div className="text-[10px]" style={{ color: TEXT_MUTED }}>
        winning
      </div>
      {showDelta && (
        <div
          className="text-[10px] mt-1.5 flex items-center justify-end gap-0.5 font-medium tabular-nums"
          style={{ color: deltaColor }}
        >
          {delta! > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {delta! > 0 ? '+' : ''}
          {delta}% from prev
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
  positiveTeamName: string;
  negativeTeamName: string;
}) {
  if (!props.active || !props.payload?.length) return null;
  const p = props.payload[0]?.payload as { advantage: number; deltaPct: number | null; round: string } | undefined;
  if (!p) return null;
  const winName = p.advantage >= 0 ? props.positiveTeamName : props.negativeTeamName;
  const sign = p.advantage >= 0 ? '+' : '';
  return (
    <div
      style={{
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: '8px 10px',
        minWidth: 150,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: TEXT_MUTED }}>
        Round {String(p.round).replace('R', '')}
      </div>
      <div className="text-sm font-semibold" style={{ color: ACCENT }}>
        {sign}
        {p.advantage}% · {winName}
      </div>
      {p.deltaPct != null && Math.abs(p.deltaPct) >= 5 && (
        <div
          className="text-[10px] mt-0.5 tabular-nums"
          style={{ color: p.deltaPct >= 0 ? ACCENT : STATUS_INJURED }}
        >
          {p.deltaPct >= 0 ? '+' : ''}
          {p.deltaPct}% vs prev round
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
// Player verdict table — resolution criteria for the trade
// (replaces the old PlayerRowGroup. Old PlayerRowGroup kept for the
//  inline mini-trajectory rendering, just no longer the headline.)
// ============================================================
/** v5 — Per-team-spine card wrapper around PlayerVerdictTable. The spine is
 *  a 6px inset box-shadow so the rest of the card sits flush; the team's
 *  "RECEIVED" header sits inside the card at the top. */
function PlayerTableSection({
  title,
  tradePlayers,
  perfById,
  teamColor,
  teamId,
  displayLabels,
}: {
  title: string;
  tradePlayers: TradePlayer[];
  perfById: Map<number, PlayerPerformance>;
  teamColor: string;
  teamId: number;
  displayLabels: Map<number, string>;
}) {
  void teamId;
  return (
    <div
      className="rounded-lg pl-5 pr-4 py-4"
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        boxShadow: `inset 6px 0 0 ${teamColor}`,
      }}
    >
      <p
        className="text-[12px] font-bold uppercase tracking-[0.15em] mb-3"
        style={{ color: teamColor }}
      >
        {title}
      </p>
      <PlayerVerdictTable
        tradePlayers={tradePlayers}
        perfById={perfById}
        teamColor={teamColor}
        displayLabels={displayLabels}
      />
    </div>
  );
}

function PlayerVerdictTable({
  tradePlayers,
  perfById,
  teamColor,
  displayLabels,
}: {
  tradePlayers: TradePlayer[];
  perfById: Map<number, PlayerPerformance>;
  teamColor: string;
  displayLabels: Map<number, string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
            <th className="text-left font-medium pr-2 pb-2">Player</th>
            <th className="text-left font-medium px-2 pb-2 whitespace-nowrap">
              <span className="inline-flex items-center gap-1">
                Verdict
                <InfoTip>
                  <strong style={{ color: TEXT }}>Per-player verdict:</strong> compares Avg Since Trade against Expected Avg. Beat by &gt;10 = Crushing. Within ±5 = Tracking. Behind by &gt;10 = Bet broken. Availability drag overrides if &lt;50% of expected games played.
                </InfoTip>
              </span>
            </th>
            <th className="text-right font-medium px-2 pb-2 whitespace-nowrap">Avg Since</th>
            <th className="text-right font-medium px-2 pb-2 whitespace-nowrap">
              <span className="inline-flex items-center gap-1 justify-end">
                Avg Before
                <InfoTip>
                  Pre-trade season average. The number in parentheses is the delta vs Expected Avg.
                </InfoTip>
              </span>
            </th>
            <th className="text-right font-medium pl-2 pb-2 whitespace-nowrap">
              <span className="inline-flex items-center gap-1 justify-end">
                Expected
                <InfoTip>
                  <strong style={{ color: TEXT }}>Expected average:</strong> the bar this player needed to clear for the trade to make sense. Locked at trade execution. Auto-derived from a position-tier baseline blended 60/40 with last-3-rounds form, or set manually at trade-logging time.
                </InfoTip>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tradePlayers.length === 0 && (
            <tr>
              <td colSpan={5} className="text-xs italic py-2" style={{ color: TEXT_MUTED }}>—</td>
            </tr>
          )}
          {tradePlayers.map((tp) => (
            <PlayerVerdictRow
              key={tp.id}
              tradePlayer={tp}
              performance={perfById.get(tp.player_id)}
              teamColor={teamColor}
              displayLabel={displayLabels.get(tp.player_id) ?? tp.player_name}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayerVerdictRow({
  tradePlayer,
  performance,
  teamColor,
  displayLabel,
}: {
  tradePlayer: TradePlayer;
  performance: PlayerPerformance | undefined;
  teamColor: string;
  displayLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const injured = performance?.injured ?? false;
  const pos =
    performance ? displayPosition(performance) : cleanPositionDisplay(tradePlayer.raw_position) ?? '—';

  const expectedAvg = tradePlayer.expected_avg ?? tradePlayer.pre_trade_avg ?? null;
  const expectedGames = tradePlayer.expected_games ?? 4;
  const actualGames = performance?.rounds_played ?? 0;
  const avgSince = actualGames > 0 ? performance!.post_trade_avg : null;
  const preAvg = tradePlayer.pre_trade_avg;

  const preDelta = preAvg != null && expectedAvg != null ? preAvg - expectedAvg : null;
  const verdict = playerVerdictFor(avgSince, expectedAvg, expectedGames, actualGames);

  // Inline mini-trajectory data when expanded
  const traj = useMemo(() => {
    if (!performance) return [] as { round: number; pts: number | null }[];
    const all: { round: number; pts: number | null }[] = [
      ...(performance.pre_trade_round_scores ?? []).map((s) => ({ round: s.round, pts: s.points })),
      ...performance.round_scores.map((s) => ({ round: s.round, pts: s.points })),
    ];
    return all.sort((a, b) => a.round - b.round);
  }, [performance]);

  // v3 — verdict colour bands per spec
  // v5 — positive verdicts take THIS table's team colour, reinforcing identity.
  // Other verdicts keep their absolute meaning bands.
  const verdictColor =
    verdict.level === 'crushing' || verdict.level === 'outperforming'
      ? teamColor
      : verdict.level === 'tracking' || verdict.level === 'pending'
        ? TEXT
        : verdict.level === 'slight-under'
          ? '#EF9F27' // soft amber
          : verdict.level === 'broken'
            ? STATUS_INJURED
            : verdict.level === 'avail-drag'
              ? TEXT_MUTED // neutral grey — availability isn't a perf verdict
              : TEXT_BODY;

  // Status dot — injured red overrides team colour
  const dotColor = injured ? STATUS_INJURED : teamColor;

  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        className="cursor-pointer"
        style={{ borderTop: `1px solid ${BORDER}` }}
      >
        <td className="py-2 pr-2 text-sm">
          <div className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: dotColor }}
              title={injured ? 'Injured' : 'Active'}
            />
            <span className="font-medium" style={{ color: TEXT }}>
              {displayLabel}
            </span>
            <span className="text-[10px]" style={{ color: TEXT_MUTED }}>
              ({pos})
            </span>
          </div>
        </td>
        {/* Verdict column — promoted to position 2 per v3 */}
        <td className="px-2 text-left text-[11px] font-semibold" style={{ color: verdictColor }}>
          {verdict.text}
        </td>
        <td className="px-2 text-right text-sm tabular-nums" style={{ color: TEXT }}>
          {avgSince != null ? Math.round(avgSince) : '—'}
          <span className="ml-1 text-[10px]" style={{ color: TEXT_MUTED }}>
            ({actualGames}/{expectedGames})
          </span>
        </td>
        <td className="px-2 text-right text-sm tabular-nums" style={{ color: TEXT_BODY }}>
          {preAvg != null ? Math.round(preAvg) : '—'}
          {preDelta != null && (
            <span
              className="ml-1 text-[10px]"
              style={{
                // Muted when delta is 0; positive deltas take the team's colour;
                // negative deltas in red.
                color:
                  preDelta === 0
                    ? TEXT_MUTED
                    : preDelta > 0
                      ? teamColor
                      : STATUS_INJURED,
              }}
            >
              ({preDelta >= 0 ? '+' : ''}
              {Math.round(preDelta)})
            </span>
          )}
        </td>
        <td className="pl-2 text-right text-sm tabular-nums" style={{ color: TEXT }}>
          <span className="inline-flex items-center gap-1 justify-end">
            {expectedAvg != null ? Math.round(expectedAvg) : '—'}
            {expectedAvg != null && (
              <InfoTip>
                <strong style={{ color: TEXT }}>Expected: {Math.round(expectedAvg)}</strong>
                <br />
                Source: {tradePlayer.expected_avg_source === 'manual' ? 'Manual override' : 'Auto-derived'}
                <br />
                Locked at trade execution — cannot be edited.
              </InfoTip>
            )}
          </span>
        </td>
      </tr>
      {expanded && traj.length > 0 && performance && (
        <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
          <td colSpan={5} className="px-2 pb-3">
            <div className="grid grid-flow-col auto-cols-fr gap-1 mt-1">
              {traj.map((s) => {
                const cell = scoreCellStyle(s.pts, baselineForPerformance(performance));
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
                    <div className="font-semibold leading-none">{s.pts == null ? 'DNP' : s.pts}</div>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
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
/** Readable foreground (white or dark navy) for a hex background. YIQ luminance. */
function readableTextOn(hex: string): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return TEXT;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? BG : TEXT;
}

/** Ordinal helper: 1 → "1st", 2 → "2nd", ... */
function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'][n % 10];
  return `${n}${suffix}`;
}

/** Y-axis label for the chart — verdict words instead of percentages. */
function verdictAxisLabel(v: number, positiveName: string, negativeName: string): string {
  if (v === 100) return `Robbery — ${shortName(positiveName)}`;
  if (v === 50) return `Edge — ${shortName(positiveName)}`;
  if (v === 0) return 'WASH';
  if (v === -50) return `Edge — ${shortName(negativeName)}`;
  if (v === -100) return `Robbery — ${shortName(negativeName)}`;
  return '';
}

/** Trim long team names to fit in the Y-axis labels. */
function shortName(name: string): string {
  if (name.length <= 14) return name;
  return name.split(' ')[0];
}

/** Small ⓘ icon with a hover tooltip — used for methodology disclosures. */
function InfoTip({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-full text-[10px] font-bold cursor-help"
        style={{
          width: 14,
          height: 14,
          background: 'rgba(255,255,255,0.10)',
          color: TEXT_BODY,
        }}
      >
        i
      </span>
      {show && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 normal-case tracking-normal"
          style={{
            background: BG,
            color: TEXT_BODY,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 11,
            fontWeight: 400,
            lineHeight: 1.5,
            width: 280,
            maxWidth: '80vw',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

function generateTicks([min, max]: [number, number]): number[] {
  const range = max - min;
  const step = range <= 20 ? 5 : range <= 40 ? 10 : 25;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
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
        {/* Trade-executed divider band — pre-trade avg rendered LARGE inside */}
        <td
          className="px-2 py-2 text-center tabular-nums"
          style={{
            background: 'rgba(255,255,255,0.06)',
            borderLeft: `1px solid rgba(255,255,255,0.20)`,
            borderRight: `1px solid rgba(255,255,255,0.20)`,
            minWidth: 52,
          }}
          title="Pre-trade average"
        >
          <div className="text-[14px] font-semibold leading-none" style={{ color: TEXT }}>
            {preAvg != null ? preAvg.toFixed(0) : '—'}
          </div>
          <div className="text-[9px] uppercase tracking-wider mt-1" style={{ color: TEXT_MUTED }}>
            pre
          </div>
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

  // Player + pre rounds + (band/pre-avg) + post rounds + post-avg
  const colSpan = 1 + preRounds.length + 1 + postRounds.length + 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
            <th className="py-1 pr-3 text-left font-medium">Player</th>
            {preRounds.length > 0 && (
              <th
                colSpan={preRounds.length}
                className="py-1 px-1 text-center font-semibold"
                style={{ borderBottom: `1px solid rgba(255,255,255,0.18)` }}
              >
                Before
              </th>
            )}
            {/* Divider header carries the TRADE EXECUTED label — neutral white,
                the band is a temporal marker not a team marker. */}
            <th
              className="py-1 px-1 text-center font-bold whitespace-nowrap"
              style={{
                color: TEXT,
                background: 'rgba(255,255,255,0.06)',
                borderLeft: `1px solid rgba(255,255,255,0.20)`,
                borderRight: `1px solid rgba(255,255,255,0.20)`,
                fontSize: 9,
                letterSpacing: '0.10em',
              }}
            >
              Trade Executed
            </th>
            {postRounds.length > 0 && (
              <th
                colSpan={postRounds.length}
                className="py-1 px-1 text-center font-semibold"
                style={{
                  color: ACCENT,
                  borderBottom: `1px solid rgba(163,255,18,0.40)`,
                }}
              >
                After
              </th>
            )}
            <th className="py-1 pl-3 text-right font-medium" style={{ color: ACCENT }}>
              Post
            </th>
          </tr>
          <tr className="text-[10px]" style={{ color: TEXT_MUTED, borderBottom: `1px solid ${BORDER}` }}>
            <th className="py-1 pr-3" />
            {preRounds.map((r) => (
              <th key={`hpre-${r}`} className="py-1 px-1 text-center font-normal">
                R{r}
              </th>
            ))}
            {/* Divider sub-header — visually empty, the band carries its own label */}
            <th
              className="py-1 px-2 text-center"
              style={{
                background: 'rgba(255,255,255,0.06)',
                borderLeft: `1px solid rgba(255,255,255,0.20)`,
                borderRight: `1px solid rgba(255,255,255,0.20)`,
              }}
            />

            {postRounds.map((r) => (
              <th
                key={`hpost-${r}`}
                className="py-1 px-1 text-center font-normal"
                style={{ color: 'rgba(163,255,18,0.70)' }}
              >
                R{r}
              </th>
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
