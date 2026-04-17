'use client';

import { ArrowRight } from 'lucide-react';
import { TEAMS } from '@/lib/constants';
import type { Trade, TradePlayer } from '@/lib/trades/types';

// List-view API adds these computed fields onto each trade player — accepted
// here for typing compatibility, but deliberately not rendered. The homepage
// card is purely factual: who traded with whom, when, which players.
type ListPlayer = TradePlayer & {
  draft_position?: string | null;
  injured?: boolean;
};

interface Props {
  trade: Trade;
  players: ListPlayer[];
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

export default function TradeCard({ trade, players, onViewDetails }: Props) {
  const teamAPlayers = players.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamBPlayers = players.filter((p) => p.receiving_team_id === trade.team_b_id);

  const coachA = coachFor(trade.team_a_id);
  const coachB = coachFor(trade.team_b_id);

  return (
    <button
      onClick={onViewDetails}
      className="text-left w-full bg-white border border-border rounded-lg p-5 hover:shadow-md hover:border-primary/30 transition-all"
    >
      {/* Top line: round + team names + View → */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">
            R{trade.round_executed}
          </span>
          <h3 className="text-base font-semibold text-foreground leading-tight">
            {trade.team_a_name} <span className="text-muted-foreground font-normal mx-1">↔</span> {trade.team_b_name}
          </h3>
        </div>
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
