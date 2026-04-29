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
import { autoExpectedAvg } from '@/lib/trades/expected';
import {
  resolvePlayerPosition,
  tierFromAvg,
  tierVerdict,
  tierDisplay,
  tierToExpectedAvg,
  type Tier,
} from '@/lib/trades/tiers';
import {
  snap5,
  verdictForProb,
  probabilityFromAdvantage,
  playerVerdictFor,
  colorForTeam,
  buildDisplayLabels,
} from '@/lib/trades/scale';
import {
  getTradeColorPair,
  getContrastingTextColor,
  hexWithOpacity,
  getCoachByTeam,
  getTeamColor,
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
  isAdmin?: boolean;
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
export default function TradeDetail({ tradeId, isAdmin = false, onBack, onDeleted }: Props) {
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

  // v8 chart data — POSITIVE COACH'S PROBABILITY on the 0..100 scale, with
  // 50 as the wash baseline. The signed-advantage ±100 scale is preserved
  // internally then transformed once via probabilityFromAdvantage().
  // Two coaches' probabilities always sum to 100 (Polymarket Yes/No logic).
  const chartData = useMemo(() => {
    if (!data) return [] as { round: string; roundNum: number; probability: number; deltaPct: number | null }[];
    const positiveIsA = data.trade.positive_team_id == null
      ? true
      : data.trade.positive_team_id === data.trade.team_a_id;
    const advFromRow = (p: TradeProbability): number => {
      if (p.advantage != null) return snap5(Number(p.advantage));
      const aEdge = (Number(p.team_a_probability) - 50) * 2;
      return snap5(positiveIsA ? aEdge : -aEdge);
    };
    const map = new Map<number, number>(); // round → probability (0..100)
    map.set(data.trade.round_executed, 50); // anchor at wash
    for (const p of data.probabilityHistory) {
      if (p.round_number === data.trade.round_executed) continue;
      map.set(p.round_number, probabilityFromAdvantage(advFromRow(p)));
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => a - b);
    return sorted.map(([round, prob], idx) => ({
      round: `R${round}`,
      roundNum: round,
      probability: prob,
      deltaPct: idx === 0 ? null : prob - sorted[idx - 1][1],
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

  // v8 — work in POSITIVE COACH'S PROBABILITY (0..100). Internally the
  // signed advantage still drives polarity; transformed once via
  // probabilityFromAdvantage().
  const advantage: number = (() => {
    if (latestProbability?.advantage != null) return snap5(Number(latestProbability.advantage));
    const aEdge = (snap5(Number(latestProbability?.team_a_probability ?? 50)) - 50) * 2;
    return positiveIsA ? aEdge : -aEdge;
  })();
  const probability = probabilityFromAdvantage(advantage); // 0..100, snapped to 5

  const positiveCoach = getCoachByTeam(positiveIsA ? trade.team_a_id : trade.team_b_id);
  const negativeCoach = getCoachByTeam(positiveIsA ? trade.team_b_id : trade.team_a_id);

  const verdict = verdictForProb(probability, positiveCoach, negativeCoach);
  // Winning team name kept for legacy callers (chart corner labels, etc.)
  const winningTeamName = advantage >= 0 ? positiveTeamName : negativeTeamName;

  // Delta vs prior round, expressed in probability points (0..100 scale).
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
      // v12 — fallback chain. Prefer the player's locked DRAFT POSITION
      // (the league-identity column added on trade_players) since that's
      // what the trade was made in the context of. Fall back through the
      // other stored positions, then the server-resolved fallback.
      pos: (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fallback = (p as any)._fallback_position as string | null | undefined;
        const pick = (...vals: (string | null | undefined)[]) =>
          vals.find((v) => typeof v === 'string' && v.trim().length > 0) ?? null;
        return pick(
          p.draft_position,
          p.raw_position,
          p.player_position,
          perfById.get(p.player_id)?.draft_position,
          fallback
        );
      })(),
      receiving_team_id: p.receiving_team_id,
      // v11 — pre-populate the new fields when editing an existing trade.
      expected_tier: p.expected_tier ?? null,
      expected_games_remaining: p.expected_games_remaining ?? null,
      expected_games_max: p.expected_games_max ?? null,
      player_context: p.player_context ?? null,
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
          {/* v11 — Edit and Delete are admin-only. Recalculate stays visible
              to all viewers since it just refreshes computation. */}
          {isAdmin && (
            <ActionButton onClick={() => setEditing(true)} icon={<Pencil size={12} />} label="Edit" />
          )}
          <ActionButton
            onClick={handleRecalculate}
            disabled={recalculating}
            icon={<RefreshCw size={12} className={recalculating ? 'animate-spin' : ''} />}
            label="Recalculate"
          />
          {isAdmin && (
            <ActionButton
              onClick={handleDelete}
              icon={<Trash2 size={12} />}
              label="Delete"
              danger
            />
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════
          v9 — Five-section structure. Each section is a bordered card with
          its own title. Sections in order: Trade Headline → Win Probability
          → Trade Justification → Trade Performance → Trade Analysis.
          ════════════════════════════════════════════════════════════════ */}

      {/* Section 1 — Trade Headline.
          v10: 'EXECUTED AFTER ROUND N' is the prominent lede above the
          surnames; coach names are dropped (they appear elsewhere on the
          page in context); 'Updated R{N}' demotes to small muted metadata. */}
      <TradeSection
        title="Trade Headline"
        titleAdornment={
          latestProbability?.round_number != null ? (
            <span className="text-[11px] ml-auto pl-3 normal-case tracking-normal font-normal" style={{ color: TEXT_MUTED }}>
              Updated R{latestProbability.round_number}
            </span>
          ) : null
        }
      >
        <div className="text-center">
          {/* v10.2 — 'After' dropped per Lipi's call. The round number alone
              is enough; the trade is implicitly after the round shown. */}
          <p className="mb-6 leading-none">
            <span
              className="font-semibold tracking-[0.04em]"
              style={{ color: TEXT, fontSize: 36 }}
            >
              Round {trade.round_executed}
            </span>
          </p>
          <PlayerHeadline
            trade={trade}
            teamAPlayers={teamAPlayers}
            teamBPlayers={teamBPlayers}
            perfById={perfById}
          />
        </div>
      </TradeSection>

      {/* Section 2 — Win Probability (chart). The 'WIN PROBABILITY' label
          above the chart is gone — the section title carries it now. The ⓘ
          methodology tooltip moves up to the section title. */}
      <TradeSection
        title="Win Probability"
        titleAdornment={
          <InfoTip>
            This is a relative-advantage score scaled as a probability for readability. <strong style={{ color: TEXT }}>50% means both coaches have equal claim to winning the trade. 100% means one coach is maximally winning.</strong> The score blends performance vs expected average (~70%) and availability vs expected games (~30%), and snaps to the nearest 5% to avoid noise.
          </InfoTip>
        }
      >
        {chartData.length < 2 ? (
          <p className="text-sm py-16 text-center" style={{ color: TEXT_MUTED }}>
            No round data yet — probabilities will appear after the next round&apos;s scores are uploaded.
          </p>
        ) : (
          <>
            {/* v6 — Loud team label ABOVE the chart. */}
            <QuadrantLabel
              direction="up"
              teamName={positiveTeamName}
              color={colorPositive}
            />

            <div className="relative">
              {/* v6 — 'Trade Executed' flag deleted. The chart's X-axis starts
                  at the trade-executed round, which makes the marker redundant.
                  The dashed vertical line stays as a subtle anchor. */}
              {/* v8.1 — wider right margin gives the endpoint label room.
                  Top and bottom margins bumped for breathing space. */}
              <ResponsiveContainer width="100%" height={420}>
                <ComposedChart data={chartData} margin={{ top: 48, right: 260, bottom: 28, left: 8 }}>
                  {/* v8 — line gradient gone, line is now plain white.
                      Team identity flows through zone shading + dot colours. */}
                  {/* v7 — Permanent territorial zones. Positive team's colour
                      tints the upper half, negative tints the lower. The line
                      runs across both zones, switching colour at the 0% line. */}
                  {/* v8 — zones remap to the 0..100 probability scale.
                      Upper half (50..100) = positive coach's territory.
                      Lower half (0..50) = negative coach's territory. */}
                  <ReferenceArea
                    y1={50}
                    y2={100}
                    fill={colorPositive}
                    fillOpacity={0.10}
                    stroke="none"
                    ifOverflow="extendDomain"
                  />
                  <ReferenceArea
                    y1={0}
                    y2={50}
                    fill={colorNegative}
                    fillOpacity={0.10}
                    stroke="none"
                    ifOverflow="extendDomain"
                  />
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="round"
                    tick={{ fontSize: 11, fill: TEXT_MUTED }}
                    axisLine={{ stroke: BORDER }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v) => `${v}%`}
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
                        positiveCoach={positiveCoach}
                        negativeCoach={negativeCoach}
                      />
                    )}
                  />
                  {/* Vertical anchor at trade-executed round */}
                  <ReferenceLine
                    x={`R${trade.round_executed}`}
                    stroke="rgba(255,255,255,0.30)"
                    strokeDasharray="2 4"
                  />
                  {/* v8 — Wash baseline at 50%. Same visual position as v7's 0
                      line, just relabelled. Solid white, full opacity. */}
                  <ReferenceLine y={50} stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} />
                  {/* v8 — Single white line trace. Team identity is carried by
                      the zone shading + per-point coloured dots; making the
                      line itself team-coloured was creating contrast issues
                      where the line matched its own zone. */}
                  <Line
                    type="monotone"
                    dataKey="probability"
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth={2}
                    dot={((dotProps: Record<string, unknown>) => {
                      const cx = dotProps.cx as number | undefined;
                      const cy = dotProps.cy as number | undefined;
                      const index = dotProps.index as number | undefined;
                      const payload = dotProps.payload as { probability?: number } | undefined;
                      const k = String(dotProps.key ?? index ?? '');
                      if (cx == null || cy == null) return <g key={k} />;
                      // Team colour by which zone the dot sits in.
                      const dotColor =
                        (payload?.probability ?? 50) >= 50 ? colorPositive : colorNegative;
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

              {/* v6 — old corner labels deleted. Replaced by loud labels
                  ABOVE and BELOW the chart (rendered as siblings around the
                  ResponsiveContainer, see the wrapping JSX). */}

              {/* v8.1 — Endpoint label. Anchored vertically to the last data
                  point on the line, sitting in the wide right-margin space.
                  Reads as a sentence: '65% chance of Doge Bombers winning the
                  trade.' */}
              <EndpointLabel
                probability={probability}
                positiveTeamName={positiveTeamName}
                negativeTeamName={negativeTeamName}
                positiveTeamId={positiveIsA ? trade.team_a_id : trade.team_b_id}
                negativeTeamId={positiveIsA ? trade.team_b_id : trade.team_a_id}
                colorPositive={colorPositive}
                colorNegative={colorNegative}
                chartHeight={420}
                topMargin={48}
                bottomMargin={28}
              />
            </div>

            {/* v6 — Loud team label BELOW the chart, ▼ glyph, full saturation. */}
            <QuadrantLabel
              direction="down"
              teamName={negativeTeamName}
              color={colorNegative}
            />
          </>
        )}
      </TradeSection>

      {/* Section 3 — Trade Justification. Holds the trader's rationale
          captured at trade-logging time. Empty state when no rationale. */}
      <TradeSection title="Trade Justification">
        {/* v12 — Justification is now an AI-written headline + bullet list
            grounded in line ranks, expected averages, and position needs.
            Locked at trade execution; regenerated on edit. The admin's raw
            context note (if present) is shown below the bullets as
            "Trader's note" so the original quote is preserved. */}
        {trade.ai_justification ? (
          <>
            <AnalysisBody narrative={trade.ai_justification} />
            {trade.context_notes && (
              <div
                className="mt-5 pl-4 text-[12px] italic leading-relaxed"
                style={{
                  color: TEXT_MUTED,
                  borderLeft: `2px solid ${colorForTeam(3194003, trade.positive_team_id)}`,
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  maxWidth: 880,
                }}
              >
                <span className="not-italic font-semibold uppercase tracking-[0.18em] text-[10px] block mb-1" style={{ color: TEXT_MUTED, fontFamily: 'inherit' }}>
                  Trader&apos;s note
                </span>
                &ldquo;{trade.context_notes}&rdquo;
              </div>
            )}
          </>
        ) : trade.context_notes ? (
          // Fallback for trades created before v12 OR when AI generation
          // failed — show the raw context as a pull-quote.
          <p
            className="text-sm italic pl-4 leading-relaxed"
            style={{
              color: TEXT_BODY,
              borderLeft: `2px solid ${colorForTeam(3194003, trade.positive_team_id)}`,
              fontFamily: 'Georgia, "Times New Roman", serif',
            }}
          >
            &ldquo;{trade.context_notes}&rdquo;
          </p>
        ) : (
          <p className="text-sm italic" style={{ color: TEXT_MUTED }}>
            Trade rationale captured at the time of the trade will appear here.
          </p>
        )}
      </TradeSection>

      {/* Section 4 — Trade Performance: player tables + the round-by-round
          breakdown accordion (now nested INSIDE this section, not bottom-of-page). */}
      <TradeSection title="Trade Performance">
        {/* v11 — admin-only nag when no player has expected_tier set.
            Surfaces that the trade is using v2 fallback intelligence and
            offers a one-click route to upgrade via the Edit flow. */}
        {isAdmin && players.every((p) => !p.expected_tier) && (
          <div
            className="rounded-md px-3 py-2 mb-4 flex items-center justify-between gap-3 flex-wrap text-[12px]"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${BORDER}`,
              color: TEXT_BODY,
            }}
          >
            <span>
              Expected tiers not set for this trade — using fallback verdicts. Re-edit
              to upgrade with the v11 tier system.
            </span>
            <button
              onClick={() => setEditing(true)}
              className="text-[12px] font-semibold whitespace-nowrap"
              style={{ color: TEXT }}
            >
              Edit trade to add →
            </button>
          </div>
        )}
        {(() => {
          const positiveIsA =
            trade.positive_team_id == null ? true : trade.positive_team_id === trade.team_a_id;
          const positivePlayers = positiveIsA ? teamAPlayers : teamBPlayers;
          const negativePlayers = positiveIsA ? teamBPlayers : teamAPlayers;
          const positiveTeamId = positiveIsA ? trade.team_a_id : trade.team_b_id;
          const postTradeWindow = Math.max(
            0,
            (latestProbability?.round_number ?? trade.round_executed) - trade.round_executed
          );
          const negativeTeamId = positiveIsA ? trade.team_b_id : trade.team_a_id;
          const positiveTN = positiveIsA ? trade.team_a_name : trade.team_b_name;
          const negativeTN = positiveIsA ? trade.team_b_name : trade.team_a_name;
          return (
            <div className="flex flex-col gap-4">
              <PlayerTableSection
                title={`${positiveTN} received`}
                tradePlayers={positivePlayers}
                perfById={perfById}
                teamColor={colorPositive}
                teamId={positiveTeamId}
                displayLabels={displayLabels}
                postTradeWindow={postTradeWindow}
              />
              <PlayerTableSection
                title={`${negativeTN} received`}
                tradePlayers={negativePlayers}
                perfById={perfById}
                teamColor={colorNegative}
                teamId={negativeTeamId}
                displayLabels={displayLabels}
                postTradeWindow={postTradeWindow}
              />
              {/* Round-by-round accordion — moved INTO Trade Performance per v9. */}
              <div
                className="rounded-lg mt-2"
                style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}` }}
              >
                <button
                  onClick={() => setShowDetails((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors"
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
                  <div style={{ borderTop: `1px solid ${BORDER}` }} className="px-4 py-4">
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
            </div>
          );
        })()}
      </TradeSection>

      {/* Section 5 — Trade Analysis. AI-written narrative only; the
          trader's pull-quote moved up to Section 3 (Trade Justification). */}
      {latestProbability?.ai_assessment && (
        <TradeSection
          title="Trade Analysis"
          titleAdornment={
            latestProbability?.round_number != null ? (
              <span className="text-[10px] ml-auto pl-3" style={{ color: TEXT_MUTED }}>
                Updated R{latestProbability.round_number}
              </span>
            ) : null
          }
        >
          <AnalysisBody narrative={latestProbability.ai_assessment} />
        </TradeSection>
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
// v9 — TradeSection: bordered card with a section title and a thin rule
// extending rightward from the title to the right edge of the card.
// ============================================================
function TradeSection({
  title,
  titleAdornment,
  children,
}: {
  title: string;
  titleAdornment?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: `1px solid rgba(255,255,255,0.08)`,
        padding: 24,
      }}
    >
      <div className="flex items-center gap-3 mb-5">
        <div
          className="text-[14px] md:text-[15px] font-semibold uppercase tracking-[0.18em] flex items-center gap-1.5 shrink-0"
          style={{ color: TEXT_MUTED }}
        >
          {title}
          {titleAdornment}
        </div>
        <div
          className="h-px flex-1"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        />
      </div>
      {children}
    </section>
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
  perfById,
}: {
  trade: Trade;
  teamAPlayers: TradePlayer[];
  teamBPlayers: TradePlayer[];
  perfById: Map<number, PlayerPerformance>;
}) {
  const allPlayers = [...teamAPlayers, ...teamBPlayers];
  const labels = buildDisplayLabels(
    allPlayers.map((p) => ({ player_id: p.player_id, player_name: p.player_name }))
  );
  const colorA = colorForTeam(trade.team_a_id, trade.positive_team_id);
  const colorB = colorForTeam(trade.team_b_id, trade.positive_team_id);

  const totalPlayers = allPlayers.length;
  const isOneForOne = teamAPlayers.length === 1 && teamBPlayers.length === 1;
  const surnameSize = isOneForOne
    ? 'text-[44px] md:text-[60px]'
    : totalPlayers <= 4
      ? 'text-[28px] md:text-[36px]'
      : 'text-[22px] md:text-[28px]';
  const arrowSize = isOneForOne ? 'text-[28px] md:text-[36px]' : 'text-[20px] md:text-[26px]';

  // v9: drop first names entirely on crowded multi-player trades to keep
  // the headline readable (4+ players per side).
  const showFirstNames = teamAPlayers.length <= 3 && teamBPlayers.length <= 3;

  return (
    <div className="flex flex-col items-center">
      {isOneForOne ? (
        <div className="flex items-baseline justify-center gap-4 flex-wrap">
          <SinglePlayerCluster
            player={teamAPlayers[0]}
            color={colorA}
            labels={labels}
            size={surnameSize}
            performance={perfById.get(teamAPlayers[0].player_id)}
            showFirstName={showFirstNames}
          />
          <span className={`${arrowSize}`} style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 300 }}>⇄</span>
          <SinglePlayerCluster
            player={teamBPlayers[0]}
            color={colorB}
            labels={labels}
            size={surnameSize}
            performance={perfById.get(teamBPlayers[0].player_id)}
            showFirstName={showFirstNames}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1 items-center">
          <PlayerRowHeadline
            players={teamAPlayers}
            color={colorA}
            receivingTeam={trade.team_a_name}
            labels={labels}
            size={surnameSize}
            perfById={perfById}
            showFirstNames={showFirstNames}
          />
          <span className={`${arrowSize} my-1`} style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 300 }}>⇅</span>
          <PlayerRowHeadline
            players={teamBPlayers}
            color={colorB}
            receivingTeam={trade.team_b_name}
            labels={labels}
            size={surnameSize}
            perfById={perfById}
            showFirstNames={showFirstNames}
          />
        </div>
      )}
      {/* Subtitle: receiving teams in their colour. */}
      <p className="text-[12px] mt-3" style={{ color: TEXT_MUTED }}>
        <span style={{ color: colorA }}>{trade.team_a_name} received</span>
        <span className="mx-3" style={{ color: 'rgba(255,255,255,0.18)' }}>|</span>
        <span style={{ color: colorB }}>{trade.team_b_name} received</span>
      </p>
    </div>
  );
}

/** v9 helper: extract the player's first name. Capitalised for sentence-case. */
function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Resolve the position to display in the headline. v9 fix: prefer the
 *  draft position via PlayerPerformance, then fall back to the raw position
 *  on the trade_players row. Never show the literal '—' character. */
function headlinePosition(
  player: TradePlayer,
  performance: PlayerPerformance | undefined
): string | null {
  if (performance) {
    const display = displayPosition(performance);
    if (display && display !== '—') return display;
  }
  return cleanPositionDisplay(player.raw_position);
}

function SinglePlayerCluster({
  player,
  color,
  labels,
  size,
  performance,
  showFirstName,
}: {
  player: TradePlayer;
  color: string;
  labels: Map<number, string>;
  size: string;
  performance: PlayerPerformance | undefined;
  showFirstName: boolean;
}) {
  const pos = headlinePosition(player, performance);
  const label = labels.get(player.player_id) ?? player.player_name;
  const firstName = firstNameOf(player.player_name);
  return (
    <div className="flex flex-col items-center">
      {showFirstName && firstName && (
        <span
          className="text-[14px] md:text-[15px] font-normal leading-none"
          style={{ color: hexWithOpacity(color, 0.55) }}
        >
          {firstName}
        </span>
      )}
      <span className={`${size} font-medium leading-none mt-1`} style={{ color }}>
        {label}
      </span>
      {pos && (
        <span
          className="text-[11px] uppercase tracking-[0.15em] mt-1.5"
          style={{ color: hexWithOpacity(color, 0.5) }}
        >
          {pos}
        </span>
      )}
    </div>
  );
}

function PlayerRowHeadline({
  players,
  color,
  receivingTeam,
  labels,
  size,
  perfById,
  showFirstNames,
}: {
  players: TradePlayer[];
  color: string;
  receivingTeam: string;
  labels: Map<number, string>;
  size: string;
  perfById: Map<number, PlayerPerformance>;
  showFirstNames: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      {/* v9 — first names render in their own row above the surname row,
          aligned over each surname. Subtle, half-saturated team colour. */}
      {showFirstNames && (
        <div className="flex items-baseline justify-center gap-x-2.5 flex-wrap">
          {players.map((p, i) => {
            const first = firstNameOf(p.player_name);
            return (
              <span
                key={`first-${p.id}`}
                className="text-[13px] font-normal leading-none"
                style={{ color: hexWithOpacity(color, 0.55) }}
              >
                {first}
                {/* spacer to match the surname-row separators */}
                {i < players.length - 1 && (
                  <span className="opacity-0 mx-2" aria-hidden>
                    ·
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
      <div className="flex items-baseline justify-center gap-x-2.5 flex-wrap mt-1">
        {players.map((p, i) => {
          const label = labels.get(p.player_id) ?? p.player_name;
          const pos = headlinePosition(p, perfById.get(p.player_id));
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
      <p className="text-[10px] uppercase tracking-[0.18em] mt-1" style={{ color }}>
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
// Quadrant label — v6 LOUD treatment above/below the chart.
// ============================================================
function QuadrantLabel({
  direction,
  teamName,
  color,
}: {
  direction: 'up' | 'down';
  teamName: string;
  color: string;
}) {
  const glyph = direction === 'up' ? '▲' : '▼';
  // v8.1 — more breathing room around the chart
  const className = direction === 'up' ? 'mb-4' : 'mt-4';
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span
        className="font-semibold uppercase tracking-[0.10em] flex items-center gap-2"
        style={{ color, fontSize: 16 }}
      >
        <span style={{ fontSize: 12 }}>{glyph}</span>
        {teamName}
      </span>
      <div className="h-px flex-1" style={{ background: hexWithOpacity(color, 0.30) }} />
    </div>
  );
}

// ============================================================
// v8.1 endpoint label — sits in the wide right-margin space, anchored
// vertically to where the latest data point lands on the chart line.
// Reads as a sentence: "65% chance of Doge Bombers winning the trade."
// ============================================================
function EndpointLabel({
  probability,
  positiveTeamName,
  negativeTeamName,
  positiveTeamId,
  negativeTeamId,
  colorPositive: _colorPositive,
  colorNegative: _colorNegative,
  chartHeight,
  topMargin,
  bottomMargin,
}: {
  probability: number;
  positiveTeamName: string;
  negativeTeamName: string;
  positiveTeamId: number;
  negativeTeamId: number;
  colorPositive: string;
  colorNegative: string;
  chartHeight: number;
  topMargin: number;
  bottomMargin: number;
}) {
  // Wash — neither side leading
  if (probability === 50) {
    // Vertically centre the label
    const top = topMargin + (chartHeight - topMargin - bottomMargin) / 2 - 16;
    return (
      <div
        className="absolute pointer-events-none"
        style={{
          right: 12,
          top,
          maxWidth: 200,
        }}
      >
        <div
          className="text-[12px] uppercase tracking-[0.20em] font-semibold"
          style={{ color: TEXT_MUTED }}
        >
          Coin flip
        </div>
        <div className="text-[14px] mt-1" style={{ color: TEXT_BODY }}>
          neither side leading
        </div>
      </div>
    );
  }

  const positiveLeading = probability > 50;
  const leaderPct = positiveLeading ? probability : 100 - probability;
  const leaderName = positiveLeading ? positiveTeamName : negativeTeamName;
  // v12 — colour the leader by the leading TEAM's actual palette colour
  // (not the positive/negative slot — that uses an abstract fallback for
  // legacy trades without polarity, which leaves the leader's accent wrong).
  const leaderColor = getTeamColor(positiveLeading ? positiveTeamId : negativeTeamId);

  // Vertical position: invert prob (since SVG Y grows downward) and map into
  // the plot area. The line endpoint sits at this y; the label hugs it.
  const innerHeight = chartHeight - topMargin - bottomMargin;
  const lineY = topMargin + (1 - probability / 100) * innerHeight;
  // Centre the label vertically against that point — roughly 28px of label
  // height gives a good visual anchor.
  const labelTop = Math.max(8, Math.min(chartHeight - 56, lineY - 24));

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        right: 16,
        top: labelTop,
        maxWidth: 200,
      }}
    >
      <div
        className="text-[36px] font-bold leading-none tabular-nums"
        style={{ color: leaderColor }}
      >
        {leaderPct}%
      </div>
      <div
        className="text-[12px] mt-1.5 leading-snug"
        style={{ color: TEXT_BODY }}
      >
        chance of <span style={{ color: leaderColor, fontWeight: 600 }}>{leaderName}</span> winning the trade.
      </div>
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
  positiveCoach: string;
  negativeCoach: string;
}) {
  if (!props.active || !props.payload?.length) return null;
  const p = props.payload[0]?.payload as
    | { probability: number; deltaPct: number | null; round: string }
    | undefined;
  if (!p) return null;
  const posProb = p.probability;
  const negProb = 100 - posProb;
  return (
    <div
      style={{
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: '8px 10px',
        minWidth: 170,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: TEXT_MUTED }}>
        Round {String(p.round).replace('R', '')}
      </div>
      <div className="flex items-baseline justify-between text-sm font-medium" style={{ color: TEXT }}>
        <span className="truncate mr-2">{props.positiveCoach}</span>
        <span className="tabular-nums">{posProb}%</span>
      </div>
      <div
        className="flex items-baseline justify-between text-sm font-medium mt-0.5"
        style={{ color: TEXT_BODY }}
      >
        <span className="truncate mr-2">{props.negativeCoach}</span>
        <span className="tabular-nums">{negProb}%</span>
      </div>
      {p.deltaPct != null && Math.abs(p.deltaPct) >= 5 && (
        <div className="text-[10px] mt-1.5 tabular-nums" style={{ color: TEXT_MUTED }}>
          {p.deltaPct >= 0 ? '+' : ''}
          {p.deltaPct}pp shift since prev round
        </div>
      )}
    </div>
  );
}

// ============================================================
// Trade analysis body — v10: tight headline (≤12 words) + bullet list.
// Compatible with both new structured payloads ("Headline.\n- bullet\n- bullet")
// and legacy prose paragraphs (sentences split into bullets).
// ============================================================
function AnalysisBody({ narrative }: { narrative: string }) {
  const { headline, bullets } = parseAnalysisNarrative(narrative);
  return (
    <div style={{ maxWidth: 880 }}>
      {headline && (
        // v12 — text-balance (Tailwind v4 utility) distributes the headline
        // evenly across lines so we don't get orphan words on the last line.
        <p
          className="text-[18px] md:text-[20px] font-medium leading-snug text-balance"
          style={{ color: TEXT }}
        >
          {headline}
        </p>
      )}
      {bullets.length > 0 && (
        <ul className="mt-4 space-y-2 pl-1">
          {bullets.map((b, i) => (
            <li
              key={i}
              className="flex items-start gap-3 text-[14px] md:text-[15px] leading-[1.55]"
              style={{ color: TEXT }}
            >
              <span className="shrink-0 mt-2" style={{ color: TEXT_MUTED }}>
                •
              </span>
              {/* text-pretty avoids single-word orphans on the last line. */}
              <span className="text-pretty" style={{ color: TEXT_BODY }}>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Parse the AI-written narrative into a tight headline + bullet list.
 *
 * v10 will eventually feed the AI a JSON-output prompt; until then this
 * gracefully handles three cases:
 *   1. Pre-structured markdown — headline on first line, '- ...' bullets.
 *   2. Legacy prose — first sentence becomes the headline, the rest is
 *      sentence-split into bullets.
 *   3. Empty — both fields undefined.
 *
 * Headline is capped at 12 words; overflow falls into the first bullet so
 * we don't lose any of the AI's content.
 */
function parseAnalysisNarrative(narrative: string): { headline: string; bullets: string[] } {
  const trimmed = (narrative ?? '').trim();
  if (!trimmed) return { headline: '', bullets: [] };

  // Case 1 — explicit bullet markers
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bulletLines = lines.filter((l) => /^[-•·*]\s+/.test(l));
  if (bulletLines.length >= 1 && lines.length > bulletLines.length) {
    const headline = lines.find((l) => !/^[-•·*]\s+/.test(l)) ?? '';
    const bullets = bulletLines.map((l) => l.replace(/^[-•·*]\s+/, ''));
    return { headline: tightenHeadline(headline), bullets };
  }

  // Case 2 — sentence-split fallback. First sentence = headline.
  const sentences = trimmed
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+/g)
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [];
  if (sentences.length === 0) {
    return { headline: tightenHeadline(trimmed), bullets: [] };
  }
  const headline = tightenHeadline(sentences[0]);
  const bullets = sentences.slice(1, 6); // cap at 5 bullets
  return { headline, bullets };
}

/**
 * Pass through the headline as-is. The AI prompt requests ≤12 words; client-
 * side truncation made things worse by cutting mid-thought. If the model
 * goes over, we'd rather render a slightly long sentence than half a one.
 */
function tightenHeadline(s: string): string {
  return s.trim();
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
  postTradeWindow,
}: {
  title: string;
  tradePlayers: TradePlayer[];
  perfById: Map<number, PlayerPerformance>;
  teamColor: string;
  teamId: number;
  displayLabels: Map<number, string>;
  postTradeWindow: number;
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
        postTradeWindow={postTradeWindow}
      />
    </div>
  );
}

function PlayerVerdictTable({
  tradePlayers,
  perfById,
  teamColor,
  displayLabels,
  postTradeWindow,
}: {
  tradePlayers: TradePlayer[];
  perfById: Map<number, PlayerPerformance>;
  teamColor: string;
  displayLabels: Map<number, string>;
  postTradeWindow: number;
}) {
  return (
    <div className="overflow-x-auto">
      {/* v10 — six-column structure with a vertical separator between the
          "Actuals" group (left) and the "Expectations" group (right).
          v10.1 — overall size bumped ~30% via base font size on the table. */}
      <table
        className="w-full"
        style={{ tableLayout: 'fixed', fontSize: 18 }}
      >
        <colgroup>
          <col style={{ width: '28%' }} />          {/* Player */}
          <col style={{ width: '14%' }} />          {/* Games Played */}
          <col style={{ width: '14%' }} />          {/* Avg Since */}
          <col style={{ width: '4%' }} />            {/* visual separator */}
          <col style={{ width: '20%' }} />          {/* Avg Before (Δ) */}
          <col style={{ width: '20%' }} />          {/* Expected (Δ) */}
        </colgroup>
        <thead>
          {/* Group header row — 'ACTUALS' over the left half, 'EXPECTATIONS' over the right. */}
          <tr className="text-[13px] uppercase tracking-[0.18em]" style={{ color: TEXT_MUTED }}>
            <th />
            <th
              colSpan={2}
              className="text-center pb-1 font-semibold"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              Actuals
            </th>
            <th />
            <th
              colSpan={2}
              className="text-center pb-1 font-semibold"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              Expectations
            </th>
          </tr>
          <tr className="text-[13px] uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
            <th className="text-left font-medium pr-2 pb-3">Player</th>
            <th className="text-right font-medium px-2 pb-3 whitespace-nowrap">Games Played</th>
            <th className="text-right font-medium px-2 pb-3 whitespace-nowrap">Avg Since</th>
            <th />
            <th className="text-right font-medium px-2 pb-3 whitespace-nowrap">
              <span className="inline-flex items-center gap-1 justify-end">
                Avg Before
                <InfoTip>
                  Pre-trade season average. The delta in parentheses compares it to Avg Since — i.e. how the player&apos;s output has changed since the trade.
                </InfoTip>
              </span>
            </th>
            <th className="text-right font-medium pl-2 pb-3 whitespace-nowrap">
              <span className="inline-flex items-center gap-1 justify-end">
                Expected
                <InfoTip placement="bottom-right">
                  <strong style={{ color: TEXT }}>Expected average:</strong> the bar this player needed to clear for the trade to make sense. Locked at trade execution. Auto-derived from a position-tier baseline blended 60/40 with last-3-rounds form. The delta in parentheses compares Avg Since to Expected.
                </InfoTip>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tradePlayers.length === 0 && (
            <tr>
              <td colSpan={6} className="text-xs italic py-2" style={{ color: TEXT_MUTED }}>—</td>
            </tr>
          )}
          {tradePlayers.map((tp) => (
            <PlayerVerdictRow
              key={tp.id}
              tradePlayer={tp}
              performance={perfById.get(tp.player_id)}
              teamColor={teamColor}
              displayLabel={displayLabels.get(tp.player_id) ?? tp.player_name}
              postTradeWindow={postTradeWindow}
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
  postTradeWindow,
}: {
  tradePlayer: TradePlayer;
  performance: PlayerPerformance | undefined;
  teamColor: string;
  displayLabel: string;
  postTradeWindow: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const injured = performance?.injured ?? false;
  const pos =
    performance ? displayPosition(performance) : cleanPositionDisplay(tradePlayer.raw_position) ?? '—';

  // Pre-trade avg fallback — if the stored value is null but we have
  // pre_trade_round_scores, compute from those so the column populates.
  const computedPreAvg = (() => {
    if (tradePlayer.pre_trade_avg != null) return tradePlayer.pre_trade_avg;
    const rs = performance?.pre_trade_round_scores ?? [];
    const played = rs.filter((s) => s.points != null && s.points > 0);
    if (played.length === 0) return null;
    return played.reduce((sum, s) => sum + (s.points ?? 0), 0) / played.length;
  })();

  // v10.3 — Expected resolution chain:
  //   1. Stored expected_avg (from trade-creation auto-derivation)
  //   2. Re-derive via autoExpectedAvg() so legacy rows get a real
  //      tier-blend value (NOT the same number as Avg Before)
  //   3. Fall back to computedPreAvg as last resort
  // Step 2 is the v10.3 fix — previously the fallback collapsed to
  // pre-trade avg, making the Avg-Before-vs-Expected delta always 0.
  const autoExpectedRes = useMemo(() => {
    if (tradePlayer.expected_avg != null) return null;
    const priorRounds = performance?.pre_trade_round_scores ?? [];
    if (priorRounds.length === 0) return null;
    return autoExpectedAvg({
      raw_position: tradePlayer.raw_position,
      draft_position: performance?.draft_position ?? null,
      prior_round_scores: priorRounds,
    });
  }, [
    tradePlayer.expected_avg,
    tradePlayer.raw_position,
    performance?.draft_position,
    performance?.pre_trade_round_scores,
  ]);
  const expectedAvg =
    tradePlayer.expected_avg ?? autoExpectedRes?.expected_avg ?? computedPreAvg ?? null;
  const expectedSourceLabel = (() => {
    if (tradePlayer.expected_avg != null) {
      return tradePlayer.expected_avg_source === 'manual'
        ? 'Source: Manual override'
        : 'Source: Auto-derived (60% position-tier baseline + 40% last-3-rounds form)';
    }
    if (autoExpectedRes != null) {
      return 'Source: Auto-derived on render (60% position-tier baseline + 40% last-3-rounds form)';
    }
    if (computedPreAvg != null) {
      return 'Source: Pre-trade average (no prior rounds for tier blend)';
    }
    return 'Source: Unavailable';
  })();

  // Dynamic post-trade window. The stored expected_games (default 4 from v2)
  // is treated as a CAP — if the user explicitly said "expect 0" at trade
  // time, that overrides. Otherwise the window is current_round - executed.
  const storedExpected = tradePlayer.expected_games;
  const isUserExplicit = storedExpected != null && storedExpected !== 4;
  const expectedGames = isUserExplicit
    ? Math.min(postTradeWindow, storedExpected as number)
    : postTradeWindow;

  const actualGames = performance?.rounds_played ?? 0;
  const avgSince = actualGames > 0 ? performance!.post_trade_avg : null;

  // v11.2 — the delta in the Avg Before cell now compares pre-trade avg to
  // POST-trade avg (avg_since − avg_before). Reads as "how the player's
  // output changed since the trade." Previously compared to Expected, but
  // that duplicated what the Expected column itself shows in its delta.
  const preDelta =
    computedPreAvg != null && avgSince != null ? avgSince - computedPreAvg : null;

  // v11 — Tier-relative verdict when the trade carries an expected_tier.
  // Otherwise fall back to v2's delta-based verdict (per addendum: existing
  // un-edited trades degrade gracefully).
  const v11Verdict = (() => {
    const betTier = tradePlayer.expected_tier as Tier | null | undefined;
    if (!betTier) return null;
    const resolvedPos = resolvePlayerPosition(tradePlayer.raw_position);
    if (!resolvedPos) return null;
    if (avgSince == null) return null; // No post-trade data yet
    const deliveredTier = tierFromAvg(avgSince, resolvedPos);
    return { tierResult: tierVerdict(deliveredTier, betTier), deliveredTier, betTier };
  })();

  const verdict = v11Verdict
    ? {
        level: v11Verdict.tierResult.level,
        text: v11Verdict.tierResult.text,
      }
    : playerVerdictFor(avgSince, expectedAvg, expectedGames, actualGames, computedPreAvg);
  void tierDisplay; void tierToExpectedAvg; // reserved for forthcoming bet/delivered badges

  // Inline mini-trajectory data when expanded
  const traj = useMemo(() => {
    if (!performance) return [] as { round: number; pts: number | null }[];
    const all: { round: number; pts: number | null }[] = [
      ...(performance.pre_trade_round_scores ?? []).map((s) => ({ round: s.round, pts: s.points })),
      ...performance.round_scores.map((s) => ({ round: s.round, pts: s.points })),
    ];
    return all.sort((a, b) => a.round - b.round);
  }, [performance]);

  // Status dot — injured red overrides team colour
  const dotColor = injured ? STATUS_INJURED : teamColor;

  // v10 — verdict reference is unused in the new column layout; kept above for
  // potential future reintroduction as Path B in the spec.
  void verdict;

  // v10 — delta vs Expected for the actuals (avg-since side). Shown next to
  // both Avg Before and Expected, so the gap reads twice.
  const sinceDelta = avgSince != null && expectedAvg != null ? avgSince - expectedAvg : null;

  // Games-played colour rule: amber when below expected (availability concern),
  // neutral white otherwise. Never red.
  const gamesColor =
    expectedGames > 0 && actualGames < expectedGames ? '#EF9F27' : TEXT;

  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        className="cursor-pointer"
        style={{ borderTop: `1px solid ${BORDER}` }}
      >
        {/* Player */}
        <td className="py-4 pr-2 text-[18px]">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: dotColor }}
              title={injured ? 'Injured' : 'Active'}
            />
            <span className="font-medium truncate" style={{ color: TEXT }}>
              {displayLabel}
            </span>
            <span className="text-[13px] shrink-0" style={{ color: TEXT_MUTED }}>
              ({pos})
            </span>
          </div>
        </td>
        {/* Games Played — own column with text label below */}
        <td className="px-2 text-right tabular-nums">
          <div className="text-[18px] font-medium" style={{ color: gamesColor }}>
            {actualGames}/{expectedGames}
          </div>
          <div className="text-[13px] mt-0.5" style={{ color: TEXT_MUTED }}>
            {availabilityText(actualGames, expectedGames)}
          </div>
        </td>
        {/* Avg Since — number only; Games column carries the (n/m) now */}
        <td className="px-2 text-right text-[20px] tabular-nums" style={{ color: TEXT }}>
          {avgSince != null ? Math.round(avgSince) : '—'}
        </td>
        {/* Visual separator between actuals and expectations */}
        <td className="p-0">
          <div
            className="mx-auto h-full"
            style={{ width: 1, background: 'rgba(255,255,255,0.12)', minHeight: 48 }}
          />
        </td>
        {/* Avg Before (Δ vs Expected) */}
        <td className="px-2 text-right text-[18px] tabular-nums" style={{ color: TEXT_BODY }}>
          {computedPreAvg != null ? Math.round(computedPreAvg) : '—'}
          <DeltaPill delta={preDelta} teamColor={teamColor} />
        </td>
        {/* Expected (Δ vs Avg Since) */}
        <td
          className="pl-2 text-right text-[18px] tabular-nums"
          style={{ color: TEXT }}
          // Per-row ⓘ removed in v10.4 — the column header carries the
          // explanation. Hover the row to inspect via the title attr if needed.
          title={
            expectedAvg != null
              ? `Expected ${Math.round(expectedAvg)} · ${expectedSourceLabel}`
              : undefined
          }
        >
          {expectedAvg != null ? Math.round(expectedAvg) : '—'}
          <DeltaPill delta={sinceDelta} teamColor={teamColor} />
        </td>
      </tr>
      {expanded && traj.length > 0 && performance && (
        <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
          <td colSpan={6} className="px-2 pb-3">
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
/**
 * v12 — DeltaPill renders the parenthetical delta after a numeric value.
 * Positive = green, negative = red, zero = muted grey, null = (—).
 * Pure semantic colours only — no team accent here.
 * Uses the proper typographic minus character (U+2212) for proper alignment.
 */
function DeltaPill({
  delta,
  teamColor: _teamColor,
}: {
  delta: number | null;
  teamColor?: string;
}) {
  if (delta == null) {
    return (
      <span className="ml-1.5 text-[13px]" style={{ color: 'rgba(155,163,181,0.55)' }}>
        (—)
      </span>
    );
  }
  const rounded = Math.round(delta);
  const color =
    rounded === 0
      ? 'rgba(155,163,181,0.55)'
      : rounded > 0
        ? '#3FBF7F'
        : '#E24B4A';
  const sign = rounded === 0 ? '+' : rounded > 0 ? '+' : '−'; // proper minus
  const magnitude = Math.abs(rounded);
  return (
    <span className="ml-1.5 text-[13px] tabular-nums" style={{ color }}>
      ({sign}
      {magnitude})
    </span>
  );
}

/**
 * v6 — replaces the cryptic "(N/M)" availability suffix with plain English.
 * 'played all 5' when actual === expected, 'missed K of N' otherwise,
 * 'no rounds yet' if the post-trade window is zero.
 */
function availabilityText(actual: number, expected: number): string {
  if (expected <= 0) return 'no rounds yet';
  if (actual >= expected) return `played all ${expected}`;
  if (actual === 0) return `missed all ${expected}`;
  return `missed ${expected - actual} of ${expected}`;
}

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

/** Small ⓘ icon with a hover tooltip — used for methodology disclosures.
 *  v12 — accepts a `placement` so the rightmost column's tooltip can
 *  anchor to the right edge of the icon (growing leftward), avoiding
 *  the horizontal-scroll overflow we saw on the Expected column. */
function InfoTip({
  children,
  placement = 'bottom-center',
}: {
  children: React.ReactNode;
  placement?: 'bottom-center' | 'bottom-right' | 'bottom-left';
}) {
  const [show, setShow] = useState(false);

  const anchorClasses =
    placement === 'bottom-right'
      ? 'right-0 top-full mt-2'
      : placement === 'bottom-left'
        ? 'left-0 top-full mt-2'
        : 'left-1/2 top-full mt-2 -translate-x-1/2';

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
          className={`absolute z-50 normal-case tracking-normal ${anchorClasses}`}
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
