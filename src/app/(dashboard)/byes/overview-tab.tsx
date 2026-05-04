'use client';

import { BYE_ROUNDS, IMPACT_META, IMPACT_GRADES_ORDERED } from '@/lib/afl-club-byes';
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
    <div className="mt-6 bg-card border border-border rounded-lg shadow-sm px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Impact scale
      </p>
      <div className="flex flex-wrap gap-2 mb-2">
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
      <ul className="text-[10px] text-muted-foreground space-y-0.5">
        <li>0 unavailable → No · 1–3 → Low · 4–6 → Medium · 7+ → Serious.</li>
        <li>
          &quot;Can&apos;t Field a Team&quot; means playable roster after byes + injuries drops below the
          scoring minimum (16 in best-16 rounds, 18 in normal rounds).
        </li>
        <li>
          Unavailable = AFL bye <em>or</em> AFL injury feed predicts the player out that round
          (deduped per player).
          {latestRound ? ` Rosters as of R${latestRound}.` : ''}
          {injuryFreshness ? ` Injury feed: ${new Date(injuryFreshness).toLocaleDateString()}.` : ''}
        </li>
      </ul>
    </div>
  );
}
