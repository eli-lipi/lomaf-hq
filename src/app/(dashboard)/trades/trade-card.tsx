'use client';

import { ArrowRight } from 'lucide-react';
import ProbabilityBar from './probability-bar';
import type { Trade, TradePlayer, TradeProbability } from '@/lib/trades/types';

interface Props {
  trade: Trade;
  players: TradePlayer[];
  latestProbability: TradeProbability | null;
  onViewDetails: () => void;
}

export default function TradeCard({ trade, players, latestProbability, onViewDetails }: Props) {
  const teamAPlayers = players.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamBPlayers = players.filter((p) => p.receiving_team_id === trade.team_b_id);

  const probA = latestProbability?.team_a_probability ?? 50;
  const probB = latestProbability?.team_b_probability ?? 50;
  const updatedRound = latestProbability?.round_number ?? null;

  return (
    <div className="bg-white border border-border rounded-lg p-5 space-y-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Trade — Round {trade.round_executed}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Logged {new Date(trade.created_at).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={onViewDetails}
          className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
        >
          View details <ArrowRight size={12} />
        </button>
      </div>

      <ProbabilityBar
        teamAId={trade.team_a_id}
        teamAName={trade.team_a_name}
        teamBId={trade.team_b_id}
        teamBName={trade.team_b_name}
        probA={probA}
        probB={probB}
      />

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            {trade.team_a_name} receives
          </p>
          <ul className="space-y-0.5">
            {teamAPlayers.map((p) => (
              <li key={p.id} className="text-xs">
                • {p.player_name}
                {p.player_position && (
                  <span className="text-muted-foreground ml-1">({p.raw_position})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            {trade.team_b_name} receives
          </p>
          <ul className="space-y-0.5">
            {teamBPlayers.map((p) => (
              <li key={p.id} className="text-xs">
                • {p.player_name}
                {p.player_position && (
                  <span className="text-muted-foreground ml-1">({p.raw_position})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {trade.context_notes && (
        <p className="text-xs italic text-muted-foreground border-l-2 border-border pl-3">
          &quot;{trade.context_notes}&quot;
        </p>
      )}

      {updatedRound !== null && (
        <p className="text-[11px] text-muted-foreground text-right">Updated R{updatedRound}</p>
      )}
    </div>
  );
}
