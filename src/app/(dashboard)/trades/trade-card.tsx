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

function firstSentence(text: string | null | undefined, max = 180): string | null {
  if (!text) return null;
  const cleaned = text.trim();
  if (!cleaned) return null;
  // Grab first sentence; fall back to character truncation
  const match = cleaned.match(/^[^.!?]+[.!?]/);
  let sentence = match ? match[0].trim() : cleaned;
  if (sentence.length > max) sentence = sentence.slice(0, max - 1).trimEnd() + '…';
  return sentence;
}

export default function TradeCard({ trade, players, latestProbability, onViewDetails }: Props) {
  const teamAPlayers = players.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamBPlayers = players.filter((p) => p.receiving_team_id === trade.team_b_id);

  const probA = Number(latestProbability?.team_a_probability ?? 50);
  const probB = Number(latestProbability?.team_b_probability ?? 50);
  const updatedRound = latestProbability?.round_number ?? null;
  const narrativeTeaser = firstSentence(latestProbability?.ai_assessment ?? null);

  return (
    <button
      onClick={onViewDetails}
      className="text-left w-full bg-white border border-border rounded-lg p-5 space-y-4 hover:shadow-md hover:border-primary/30 transition-all"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            After Round {trade.round_executed}
          </p>
          <h3 className="text-sm font-semibold text-foreground mt-0.5 truncate">
            {trade.team_a_name} <span className="text-muted-foreground font-normal">↔</span>{' '}
            {trade.team_b_name}
          </h3>
        </div>
        <span className="text-xs font-medium text-primary flex items-center gap-1 shrink-0">
          View <ArrowRight size={12} />
        </span>
      </div>

      {/* Players exchanged */}
      <div className="grid grid-cols-2 gap-4">
        <PlayerList teamName={trade.team_a_name} players={teamAPlayers} />
        <PlayerList teamName={trade.team_b_name} players={teamBPlayers} />
      </div>

      {/* Probability bar */}
      <ProbabilityBar
        teamAId={trade.team_a_id}
        teamAName={trade.team_a_name}
        teamBId={trade.team_b_id}
        teamBName={trade.team_b_name}
        probA={probA}
        probB={probB}
      />

      {/* AI narrative teaser */}
      {narrativeTeaser && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
          <span className="mr-1">🧠</span>
          {narrativeTeaser}
        </p>
      )}

      {updatedRound !== null && (
        <p className="text-[11px] text-muted-foreground text-right">Updated R{updatedRound}</p>
      )}
    </button>
  );
}

function PlayerList({ teamName, players }: { teamName: string; players: TradePlayer[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 truncate">
        {teamName} gets
      </p>
      <ul className="space-y-1">
        {players.map((p) => (
          <li key={p.id} className="flex items-baseline gap-1.5 text-xs">
            <span className="truncate font-medium">{p.player_name}</span>
            {p.raw_position && (
              <span className="text-[10px] text-muted-foreground shrink-0">{p.raw_position}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
