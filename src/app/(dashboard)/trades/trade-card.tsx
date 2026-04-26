'use client';

import { ArrowRight } from 'lucide-react';
import { TEAMS } from '@/lib/constants';
import { getTeamColor } from '@/lib/team-colors';
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
    <button
      onClick={onViewDetails}
      className="text-left w-full bg-white border border-border rounded-lg p-5 hover:shadow-md hover:border-primary/30 transition-all"
    >
      {/* Top line: team names + View → (round is rendered as a section header above) */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="min-w-0 text-base font-semibold text-foreground leading-tight">
          {trade.team_a_name} <span className="text-muted-foreground font-normal mx-1">↔</span> {trade.team_b_name}
        </h3>
        <span className="text-xs font-medium text-primary flex items-center gap-1 shrink-0 pt-0.5">
          View <ArrowRight size={12} />
        </span>
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

      {/* Win-probability ticker — small, clean, just enough signal to entice a click */}
      {showTicker && (
        <ProbTicker
          teamAName={trade.team_a_name}
          teamBName={trade.team_b_name}
          teamAColor={getTeamColor(trade.team_a_id)}
          teamBColor={getTeamColor(trade.team_b_id)}
          probA={probA!}
          probB={probB!}
          updatedRound={latestProbability!.round_number}
        />
      )}
    </button>
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
  teamAColor,
  teamBColor,
  probA,
  probB,
  updatedRound,
}: {
  teamAName: string;
  teamBName: string;
  teamAColor: string;
  teamBColor: string;
  probA: number;
  probB: number;
  updatedRound: number;
}) {
  const winningIsA = probA >= probB;
  const winColor = winningIsA ? teamAColor : teamBColor;
  const winName = winningIsA ? teamAName : teamBName;
  const winPct = Math.round(winningIsA ? probA : probB);

  return (
    <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span
          className="text-base font-bold tabular-nums shrink-0"
          style={{ color: winColor }}
        >
          {winPct}%
        </span>
        <span className="text-xs text-muted-foreground truncate">
          {winName} winning
        </span>
      </div>
      {/* Slim two-segment bar for visual weight without dominating the card */}
      <div className="hidden sm:flex h-1.5 w-24 rounded-full overflow-hidden shrink-0">
        <div style={{ width: `${probA}%`, backgroundColor: teamAColor }} />
        <div style={{ width: `${probB}%`, backgroundColor: teamBColor }} />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        R{updatedRound}
      </span>
    </div>
  );
}
