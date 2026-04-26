'use client';

import { ArrowRight } from 'lucide-react';
import { TEAMS } from '@/lib/constants';
import type { Trade, TradePlayer, TradeProbability } from '@/lib/trades/types';

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

/** Get just the player's surname (last token), keeping things scannable. */
function surname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : fullName;
}

/** Pull coach name from TEAMS lookup; fall back to empty if unknown. */
function coachFor(teamId: number): string {
  return TEAMS.find((t) => t.team_id === teamId)?.coach ?? '';
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

  // Probability ticker — only shown if we have post-trade data. If both sides
  // are 50/50 and no rounds have played, hide it (50/50 isn't informative).
  const probA = latestProbability ? Number(latestProbability.team_a_probability) : null;
  const probB = latestProbability ? Number(latestProbability.team_b_probability) : null;
  const showTicker =
    probA != null &&
    probB != null &&
    latestProbability != null &&
    latestProbability.round_number > trade.round_executed;

  return (
    <div className="bg-white border border-border rounded-lg p-5 hover:shadow-md hover:border-primary/30 transition-all">
      {/* Top line: team names */}
      <div className="mb-2">
        <h3 className="min-w-0 text-base font-semibold text-foreground leading-tight">
          {trade.team_a_name} <span className="text-muted-foreground font-normal mx-1">↔</span>{' '}
          {trade.team_b_name}
        </h3>
      </div>

      {/* Coach names (muted, below team headline) */}
      {(coachA || coachB) && (
        <div className="flex items-baseline gap-3 text-xs text-muted-foreground mb-3 flex-wrap">
          <span>{coachA}</span>
          <span className="text-muted-foreground/60">·</span>
          <span>{coachB}</span>
        </div>
      )}

      {/* Players received per side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <PlayerLine players={teamAPlayers} />
        <PlayerLine players={teamBPlayers} />
      </div>

      {/* Win-probability ticker — neutral colors, sparkline trajectory */}
      {showTicker && (
        <ProbTicker
          teamAName={trade.team_a_name}
          teamBName={trade.team_b_name}
          teamAId={trade.team_a_id}
          teamBId={trade.team_b_id}
          probA={probA!}
          probB={probB!}
          probabilityHistory={probabilityHistory ?? []}
          roundExecuted={trade.round_executed}
        />
      )}

      {/* CTA button — full-width, prominent, single click target */}
      <button
        onClick={onViewDetails}
        className="mt-4 w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-md px-4 py-2.5 text-sm font-semibold"
      >
        View Trade Analysis
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

function PlayerLine({ players }: { players: ListPlayer[] }) {
  if (players.length === 0) {
    return <p className="text-xs italic text-muted-foreground">—</p>;
  }
  const names = players.map((p) => surname(p.player_name)).join(', ');
  return (
    <div>
      <p className="text-foreground leading-snug">{names}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">
        ({players.length} {players.length === 1 ? 'player' : 'players'})
      </p>
    </div>
  );
}

function ProbTicker({
  teamAName,
  teamBName,
  teamAId,
  teamBId,
  probA,
  probB,
  probabilityHistory,
  roundExecuted,
}: {
  teamAName: string;
  teamBName: string;
  teamAId: number;
  teamBId: number;
  probA: number;
  probB: number;
  probabilityHistory: TradeProbability[];
  roundExecuted: number;
}) {
  const winningIsA = probA >= probB;
  const winName = winningIsA ? teamAName : teamBName;
  const winPct = Math.round(winningIsA ? probA : probB);

  // Sparkline data: probability of the WINNING side over time. Anchor at 50%
  // for the round of execution so the line always starts from the neutral
  // baseline and shows the trajectory away from it.
  const sortedHistory = [...probabilityHistory].sort(
    (a, b) => a.round_number - b.round_number
  );
  const points: { x: number; y: number }[] = [];
  // Anchor at round_executed = 50%
  points.push({ x: roundExecuted, y: 50 });
  for (const p of sortedHistory) {
    if (p.round_number === roundExecuted) continue; // dedupe
    const sideProb = winningIsA
      ? Number(p.team_a_probability)
      : Number(p.team_b_probability);
    points.push({ x: p.round_number, y: sideProb });
  }
  // Suppress IDE complaints about unused team IDs (kept for callers / future)
  void teamAId;
  void teamBId;

  return (
    <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-base font-bold tabular-nums text-foreground shrink-0">
          {winPct}%
        </span>
        <span className="text-xs text-muted-foreground truncate">{winName} winning</span>
      </div>
      {points.length >= 2 ? (
        <Sparkline points={points} />
      ) : (
        <span className="text-[10px] text-muted-foreground italic shrink-0">
          tracking...
        </span>
      )}
    </div>
  );
}

/**
 * Tiny SVG sparkline showing probability trajectory. Neutral muted color —
 * the homepage shouldn't shout team colors at every card. The 50% baseline
 * is faintly drawn so trajectory direction is readable at a glance.
 */
function Sparkline({ points }: { points: { x: number; y: number }[] }) {
  const width = 96;
  const height = 28;
  const padding = 2;

  const xs = points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const xRange = Math.max(1, maxX - minX);

  // Y is fixed 0..100 so trajectory is comparable across cards
  const toX = (x: number) =>
    padding + ((x - minX) / xRange) * (width - padding * 2);
  const toY = (y: number) =>
    padding + ((100 - y) / 100) * (height - padding * 2);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x).toFixed(1)} ${toY(p.y).toFixed(1)}`)
    .join(' ');

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
      {/* Faint 50% baseline so direction reads */}
      <line
        x1={padding}
        x2={width - padding}
        y1={baselineY}
        y2={baselineY}
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeDasharray="2 2"
        strokeWidth={1}
        className="text-muted-foreground"
      />
      {/* The trajectory */}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-foreground/70"
      />
      {/* Endpoint dot (current state) */}
      <circle
        cx={toX(last.x)}
        cy={toY(last.y)}
        r={2.5}
        className="fill-foreground"
      />
    </svg>
  );
}
