'use client';

import { TEAMS } from '@/lib/constants';
import {
  snap5,
  buildDisplayLabels,
  colorForTeam,
  COLOR_POSITIVE,
  COLOR_NEGATIVE,
} from '@/lib/trades/scale';
import { cleanPositionDisplay } from '@/lib/trades/positions';
import type { Trade, TradePlayer, TradeProbability } from '@/lib/trades/types';

// Shared dark-theme tokens (kept in sync with trade-detail.tsx)
const SURFACE = 'rgba(255,255,255,0.03)';
const SURFACE_HOVER = 'rgba(255,255,255,0.05)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT = '#FFFFFF';
const TEXT_BODY = '#9AA3B5';
const TEXT_MUTED = '#6B7589';

// List-view API adds these computed fields onto each trade player.
type ListPlayer = TradePlayer & {
  draft_position?: string | null;
  injured?: boolean;
};

interface Props {
  trade: Trade;
  players: ListPlayer[];
  latestProbability?: TradeProbability | null;
  probabilityHistory?: TradeProbability[];
  onViewDetails: () => void;
}

function coachFor(teamId: number): string {
  return TEAMS.find((t) => t.team_id === teamId)?.coach ?? '';
}

/** Verdict label for the homepage card — short version. */
function shortVerdict(adv: number): string {
  const abs = Math.abs(adv);
  if (abs <= 10) return 'COIN FLIP';
  if (abs <= 30) return 'SLIGHT EDGE';
  if (abs <= 55) return 'EDGE';
  if (abs <= 80) return 'BIG EDGE';
  return 'ROBBERY';
}

export default function TradeCard({
  trade,
  players,
  latestProbability,
  probabilityHistory,
  onViewDetails,
}: Props) {
  const teamAPlayers = players.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamBPlayers = players.filter((p) => p.receiving_team_id === trade.team_b_id);

  // Per-trade colours — green for positive side, cyan for negative
  const colorA = colorForTeam(trade.team_a_id, trade.positive_team_id);
  const colorB = colorForTeam(trade.team_b_id, trade.positive_team_id);

  const labels = buildDisplayLabels(
    players.map((p) => ({ player_id: p.player_id, player_name: p.player_name }))
  );

  // Polarity-aware advantage on the ±100 scale. Falls back to deriving from
  // team_a_probability for legacy rows.
  const positiveIsA = trade.positive_team_id == null
    ? true
    : trade.positive_team_id === trade.team_a_id;
  const advantage: number | null = (() => {
    if (latestProbability?.advantage != null) return snap5(Number(latestProbability.advantage));
    if (latestProbability == null) return null;
    const aEdge = (snap5(Number(latestProbability.team_a_probability)) - 50) * 2;
    return positiveIsA ? aEdge : -aEdge;
  })();
  const showProb =
    advantage != null &&
    latestProbability != null &&
    latestProbability.round_number > trade.round_executed;

  const positiveTeamName = positiveIsA ? trade.team_a_name : trade.team_b_name;
  const negativeTeamName = positiveIsA ? trade.team_b_name : trade.team_a_name;

  // Sparkline points: signed advantage over time
  const sortedHistory = [...(probabilityHistory ?? [])].sort(
    (a, b) => a.round_number - b.round_number
  );
  const sparkPoints: { x: number; y: number }[] = [];
  sparkPoints.push({ x: trade.round_executed, y: 0 });
  for (const p of sortedHistory) {
    if (p.round_number === trade.round_executed) continue;
    let adv: number;
    if (p.advantage != null) adv = snap5(Number(p.advantage));
    else {
      const aEdge = (snap5(Number(p.team_a_probability)) - 50) * 2;
      adv = positiveIsA ? aEdge : -aEdge;
    }
    sparkPoints.push({ x: p.round_number, y: adv });
  }

  const winningName =
    advantage != null && advantage >= 0 ? positiveTeamName : negativeTeamName;
  const winningColor = advantage != null && advantage > 0 ? colorForTeam(trade.positive_team_id ?? trade.team_a_id, trade.positive_team_id) : advantage != null && advantage < 0 ? colorForTeam(trade.negative_team_id ?? trade.team_b_id, trade.positive_team_id) : TEXT;

  const coachA = coachFor(trade.team_a_id);
  const coachB = coachFor(trade.team_b_id);

  return (
    <button
      onClick={onViewDetails}
      className="text-left w-full rounded-xl px-5 py-4 transition-all"
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = SURFACE_HOVER;
        e.currentTarget.style.borderColor = 'rgba(163,255,18,0.30)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = SURFACE;
        e.currentTarget.style.borderColor = BORDER;
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
        {/* LEFT — surname-first headline */}
        <div className="min-w-0">
          <CardPlayerHeadline
            teamAPlayers={teamAPlayers}
            teamBPlayers={teamBPlayers}
            colorA={colorA}
            colorB={colorB}
            labels={labels}
          />
          <p className="text-[11px] mt-3 uppercase tracking-[0.10em]" style={{ color: TEXT_MUTED }}>
            R{trade.round_executed}
            {coachA && coachB && (
              <>
                <span className="mx-2 normal-case" style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>
                <span className="normal-case">{coachA} vs {coachB}</span>
              </>
            )}
          </p>
        </div>

        {/* RIGHT — sparkline + price + verdict */}
        {showProb && advantage != null ? (
          <div className="flex flex-col items-end gap-1 shrink-0 min-w-[140px]">
            <Sparkline points={sparkPoints} colorA={colorA} colorB={colorB} />
            <div
              className="text-2xl font-bold leading-none tabular-nums"
              style={{ color: winningColor }}
            >
              {advantage > 0 ? '+' : ''}
              {advantage}%
            </div>
            <div
              className="text-[10px] font-bold uppercase tracking-[0.10em] truncate max-w-[160px]"
              style={{ color: winningColor }}
            >
              {shortVerdict(advantage)}
            </div>
            <div className="text-[10px] truncate max-w-[180px]" style={{ color: TEXT_MUTED }}>
              {trade.team_a_name} ⇄ {trade.team_b_name}
            </div>
          </div>
        ) : (
          <div className="text-[10px] italic shrink-0" style={{ color: TEXT_MUTED }}>
            tracking…
          </div>
        )}
      </div>
    </button>
  );
}

/** Surname-first card headline. 1-for-1 → side-by-side; multi-player → stacked rows. */
function CardPlayerHeadline({
  teamAPlayers,
  teamBPlayers,
  colorA,
  colorB,
  labels,
}: {
  teamAPlayers: ListPlayer[];
  teamBPlayers: ListPlayer[];
  colorA: string;
  colorB: string;
  labels: Map<number, string>;
}) {
  const isOneForOne = teamAPlayers.length === 1 && teamBPlayers.length === 1;
  if (isOneForOne) {
    return (
      <div className="flex items-baseline gap-3 flex-wrap">
        <CardSinglePlayer player={teamAPlayers[0]} color={colorA} labels={labels} />
        <span className="text-[18px] font-light" style={{ color: 'rgba(255,255,255,0.45)' }}>⇄</span>
        <CardSinglePlayer player={teamBPlayers[0]} color={colorB} labels={labels} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <CardPlayerRow players={teamAPlayers} color={colorA} labels={labels} />
      <span className="text-[14px] font-light" style={{ color: 'rgba(255,255,255,0.45)' }}>⇅</span>
      <CardPlayerRow players={teamBPlayers} color={colorB} labels={labels} />
    </div>
  );
}

function CardSinglePlayer({
  player,
  color,
  labels,
}: {
  player: ListPlayer;
  color: string;
  labels: Map<number, string>;
}) {
  const label = labels.get(player.player_id) ?? player.player_name;
  const pos = cleanPositionDisplay(player.draft_position) ?? cleanPositionDisplay(player.raw_position);
  return (
    <div className="flex flex-col items-start">
      <span className="text-[22px] md:text-[24px] font-medium leading-none" style={{ color }}>
        {label}
      </span>
      {pos && (
        <span className="text-[10px] uppercase tracking-[0.15em] mt-1" style={{ color: TEXT_MUTED }}>
          {pos}
        </span>
      )}
    </div>
  );
}

function CardPlayerRow({
  players,
  color,
  labels,
}: {
  players: ListPlayer[];
  color: string;
  labels: Map<number, string>;
}) {
  return (
    <span className="text-[16px] md:text-[18px] font-medium leading-tight">
      {players.map((p, i) => {
        const label = labels.get(p.player_id) ?? p.player_name;
        const pos = cleanPositionDisplay(p.draft_position) ?? cleanPositionDisplay(p.raw_position);
        return (
          <span key={p.id}>
            <span style={{ color }}>{label}</span>
            {pos && (
              <span className="text-[10px] ml-1 uppercase" style={{ color: TEXT_MUTED }}>
                ({pos})
              </span>
            )}
            {i < players.length - 1 && (
              <span style={{ color: 'rgba(255,255,255,0.18)' }}> · </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Compact SVG sparkline — green above 0, cyan below, using gradient stroke. */
function Sparkline({
  points,
  colorA: _colorA,
  colorB: _colorB,
}: {
  points: { x: number; y: number }[];
  colorA: string;
  colorB: string;
}) {
  if (points.length < 2) {
    return <div className="text-[10px] italic" style={{ color: TEXT_MUTED }}>tracking…</div>;
  }
  // Suppress unused-warning since we keep the team colours available for future
  // per-side fills if needed.
  void _colorA;
  void _colorB;

  const width = 110;
  const height = 30;
  const padding = 2;

  const xs = points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const xRange = Math.max(1, maxX - minX);

  // Y axis fixed −100..+100 to match the detail chart
  const yMin = -100;
  const yMax = 100;
  const yRange = yMax - yMin;

  const toX = (x: number) => padding + ((x - minX) / xRange) * (width - padding * 2);
  const toY = (y: number) => padding + ((yMax - y) / yRange) * (height - padding * 2);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x).toFixed(1)} ${toY(p.y).toFixed(1)}`)
    .join(' ');

  const baselineY = toY(0);
  const last = points[points.length - 1];
  const lastColor = last.y > 0 ? COLOR_POSITIVE : last.y < 0 ? COLOR_NEGATIVE : TEXT;
  const gradientId = `spark-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        {/* Vertical gradient — green above 0, cyan below */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLOR_POSITIVE} />
          <stop offset="50%" stopColor={COLOR_POSITIVE} />
          <stop offset="50%" stopColor={COLOR_NEGATIVE} />
          <stop offset="100%" stopColor={COLOR_NEGATIVE} />
        </linearGradient>
      </defs>
      {/* Faint baseline */}
      {baselineY >= padding && baselineY <= height - padding && (
        <line
          x1={padding}
          x2={width - padding}
          y1={baselineY}
          y2={baselineY}
          stroke="rgba(255,255,255,0.30)"
          strokeWidth={1}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={toX(last.x)} cy={toY(last.y)} r={2.5} fill={lastColor} />
    </svg>
  );
}
