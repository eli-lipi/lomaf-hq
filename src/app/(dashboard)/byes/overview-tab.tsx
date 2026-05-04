'use client';

import {
  BYE_ROUNDS,
  IMPACT_META,
  IMPACT_GRADES_ORDERED,
} from '@/lib/afl-club-byes';
import { RoundImpactCard } from './round-impact-card';
import type { ByeData } from './use-bye-data';

export default function OverviewTab({ data }: { data: ByeData }) {
  if (data.loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading bye schedule…</div>;
  }

  return (
    <>
      {!data.hasRosters && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-900 text-sm">
          No roster data uploaded yet — coach impact rankings will populate once a Points Grid is uploaded.
        </div>
      )}

      <div className="space-y-5">
        {BYE_ROUNDS.map((round) => (
          <RoundImpactCard key={round} round={round} ladder={data.impactByRound[round]} />
        ))}
      </div>

      <Legend latestRound={data.latestRound} injuryFreshness={data.injuryFreshness} />
    </>
  );
}

function Legend({ latestRound, injuryFreshness }: { latestRound: number; injuryFreshness: string | null }) {
  return (
    <div className="mt-6 bg-card border border-border rounded-lg shadow-sm px-4 py-3 space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Impact scale
      </p>
      <div className="flex flex-wrap gap-2">
        {IMPACT_GRADES_ORDERED.map((g) => {
          const meta = IMPACT_META[g];
          return (
            <span
              key={g}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ background: meta.bg, color: meta.fg }}
            >
              {meta.label}
            </span>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Each grade has thresholds on <strong>both</strong> player count and avg points lost — crossing
        either bumps you up.
      </p>
      <ul className="text-[10px] text-muted-foreground space-y-0.5">
        <li><strong>No Impact</strong> — 0 players, 0 pts</li>
        <li><strong>Low Impact</strong> — 1–3 players <em>or</em> 1–249 pts</li>
        <li><strong>Medium Impact</strong> — 4–6 players <em>or</em> 250–499 pts</li>
        <li><strong>High Impact</strong> — 7+ players (still fieldable) <em>or</em> 500–699 pts</li>
        <li><strong>Can&apos;t Field a Team</strong> — playable roster drops below the scoring minimum (16 in best-16 rounds, 18 in normal) <em>or</em> 700+ pts lost</li>
      </ul>
      <p className="text-[10px] text-muted-foreground pt-2 border-t border-border/50">
        Unavailable = AFL bye <em>or</em> AFL injury feed predicts the player out that round
        (deduped per player). Players with 100+ avg get a ⭐ in expanded lists.
        {latestRound ? ` Rosters as of R${latestRound}.` : ''}
        {injuryFreshness ? ` Injury feed: ${new Date(injuryFreshness).toLocaleDateString()}.` : ''}
      </p>
    </div>
  );
}
