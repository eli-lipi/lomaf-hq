'use client';

import { TEAMS } from '@/lib/constants';
import type { Trade, TradePlayer, TradeProbability } from '@/lib/trades/types';

// Shared dark-theme tokens (kept in sync with trade-detail.tsx)
const SURFACE = 'rgba(255,255,255,0.03)';
const SURFACE_HOVER = 'rgba(255,255,255,0.05)';
const BORDER = 'rgba(255,255,255,0.08)';
const ACCENT = '#A3FF12';
const TEXT = '#FFFFFF';
const TEXT_BODY = '#9AA3B5';
const TEXT_MUTED = '#6B7589';
const STATUS_INJURED = '#E24B4A';

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

/** Snap a percentage to the nearest 5 — matches the storage-side snap in
 *  compute-probability.ts so trades never display non-5%-aligned numbers
 *  even while older data hasn't been recalculated yet. */
function snap5(pct: number): number {
  return Math.round(pct / 5) * 5;
}

function surname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : fullName;
}

function coachFor(teamId: number): string {
  return TEAMS.find((t) => t.team_id === teamId)?.coach ?? '';
}

/** Win % colour weight: <10% from 50 = white, 10-25% = mild green, >25% = strong green/red. */
function winPctColor(pct: number): string {
  const delta = Math.abs(pct - 50);
  if (delta < 10) return TEXT;
  if (delta < 25) return ACCENT;
  return ACCENT; // strong tint same hue, font weight handles emphasis
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

  const coachA = coachFor(trade.team_a_id);
  const coachB = coachFor(trade.team_b_id);

  const probA = latestProbability ? Number(latestProbability.team_a_probability) : null;
  const probB = latestProbability ? Number(latestProbability.team_b_probability) : null;
  const showProb =
    probA != null &&
    probB != null &&
    latestProbability != null &&
    latestProbability.round_number > trade.round_executed;

  // Build the sparkline history aligned to the WINNING side (so the line
  // always reads "moving up = winner consolidating").
  const sortedHistory = [...(probabilityHistory ?? [])].sort(
    (a, b) => a.round_number - b.round_number
  );
  const aWins = (probA ?? 50) >= (probB ?? 50);
  const sparkPoints: { x: number; y: number }[] = [];
  sparkPoints.push({ x: trade.round_executed, y: 50 });
  for (const p of sortedHistory) {
    if (p.round_number === trade.round_executed) continue;
    const sideProb = aWins ? Number(p.team_a_probability) : Number(p.team_b_probability);
    sparkPoints.push({ x: p.round_number, y: snap5(sideProb) });
  }
  const winPct = aWins ? probA : probB;
  const winName = aWins ? trade.team_a_name : trade.team_b_name;

  return (
    <button
      onClick={onViewDetails}
      className="text-left w-full rounded-xl p-5 transition-all"
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
        {/* LEFT: trade content */}
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight" style={{ color: TEXT }}>
            {trade.team_a_name}
            <span className="mx-2 font-normal" style={{ color: TEXT_MUTED }}>
              ⇄
            </span>
            {trade.team_b_name}
          </h3>
          {(coachA || coachB) && (
            <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>
              {coachA}
              <span className="mx-2" style={{ color: 'rgba(255,255,255,0.15)' }}>
                ·
              </span>
              {coachB}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-sm">
            <PlayerLine players={teamAPlayers} />
            <PlayerLine players={teamBPlayers} />
          </div>
        </div>

        {/* RIGHT: probability snapshot — sparkline + price */}
        {showProb && winPct != null && (
          <div className="flex flex-col items-end gap-1 shrink-0 min-w-[120px]">
            <Sparkline points={sparkPoints} />
            <div
              className="text-2xl font-bold leading-none tabular-nums"
              style={{ color: winPctColor(winPct) }}
            >
              {snap5(winPct)}%
            </div>
            <div className="text-[10px] truncate max-w-[140px]" style={{ color: TEXT_MUTED }}>
              {winName} winning
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

function PlayerLine({ players }: { players: ListPlayer[] }) {
  if (players.length === 0) {
    return <p className="text-xs italic" style={{ color: TEXT_MUTED }}>—</p>;
  }
  // Format names with positions when there are few enough to scan; collapse
  // to surname-only with a count for big trades.
  const renderable = players.length <= 3
    ? players.map((p) => ({ name: surname(p.player_name), pos: p.draft_position || p.raw_position || null, injured: p.injured }))
    : players.map((p) => ({ name: surname(p.player_name), pos: p.draft_position || p.raw_position || null, injured: p.injured }));

  return (
    <div className="leading-relaxed">
      {renderable.map((r, i) => (
        <span key={i} className="text-sm" style={{ color: TEXT }}>
          {r.name}
          {r.pos && (
            <span className="text-[10px] ml-1" style={{ color: TEXT_MUTED }}>
              ({r.pos})
            </span>
          )}
          {r.injured && (
            <span
              className="ml-1 inline-block w-1.5 h-1.5 rounded-full align-middle"
              style={{ background: STATUS_INJURED }}
              title="Injured"
            />
          )}
          {i < renderable.length - 1 && <span style={{ color: TEXT_MUTED }}>, </span>}
        </span>
      ))}
    </div>
  );
}

/** Compact SVG sparkline — auto-zoomed to data range. */
function Sparkline({ points }: { points: { x: number; y: number }[] }) {
  if (points.length < 2) {
    return <div className="text-[10px] italic" style={{ color: TEXT_MUTED }}>tracking…</div>;
  }
  const width = 96;
  const height = 28;
  const padding = 2;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const xRange = Math.max(1, maxX - minX);

  // Auto-zoom Y axis — keeps tiny moves visible
  const minY = Math.min(...ys, 50);
  const maxY = Math.max(...ys, 50);
  let yMin = Math.max(0, Math.floor((minY - 5) / 5) * 5);
  let yMax = Math.min(100, Math.ceil((maxY + 5) / 5) * 5);
  if (yMax - yMin < 20) {
    yMin = Math.max(0, Math.min(yMin, 30));
    yMax = Math.min(100, Math.max(yMax, 70));
  }
  const yRange = Math.max(1, yMax - yMin);

  const toX = (x: number) => padding + ((x - minX) / xRange) * (width - padding * 2);
  const toY = (y: number) => padding + ((yMax - y) / yRange) * (height - padding * 2);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x).toFixed(1)} ${toY(p.y).toFixed(1)}`)
    .join(' ');
  // Closed area path for fill
  const areaPath =
    `M ${toX(points[0].x).toFixed(1)} ${(height - padding).toFixed(1)} ` +
    points
      .map((p) => `L ${toX(p.x).toFixed(1)} ${toY(p.y).toFixed(1)}`)
      .join(' ') +
    ` L ${toX(points[points.length - 1].x).toFixed(1)} ${(height - padding).toFixed(1)} Z`;

  const baselineY = toY(50);
  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity={0.30} />
          <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Faint baseline */}
      {baselineY >= padding && baselineY <= height - padding && (
        <line
          x1={padding}
          x2={width - padding}
          y1={baselineY}
          y2={baselineY}
          stroke="rgba(255,255,255,0.20)"
          strokeDasharray="2 2"
          strokeWidth={1}
        />
      )}
      <path d={areaPath} fill="url(#sparkfill)" />
      <path
        d={path}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={toX(last.x)} cy={toY(last.y)} r={2.5} fill={ACCENT} />
    </svg>
  );
}
