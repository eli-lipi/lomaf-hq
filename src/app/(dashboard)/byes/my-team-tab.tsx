'use client';

import { useMemo, useState } from 'react';
import { TEAMS, getTeamById } from '@/lib/constants';
import { TEAM_COLOR_MAP } from '@/lib/team-colors';
import {
  BYE_ROUNDS,
  IMPACT_META,
  POINTS_META,
  type ImpactGrade,
  type PointsGrade,
} from '@/lib/afl-club-byes';
import { RoundImpactCard } from './round-impact-card';
import type { ByeData } from './use-bye-data';

interface Props {
  data: ByeData;
  /** Logged-in coach's team_id, used as the default selection. */
  defaultTeamId: number | null;
}

export default function MyTeamTab({ data, defaultTeamId }: Props) {
  // Ordering: TEAMS as defined in constants.ts. Default to the user's team
  // if they have one, otherwise the first team — admins viewing the page
  // without a team can still flip through.
  const [selectedTeamId, setSelectedTeamId] = useState<number>(
    defaultTeamId ?? TEAMS[0].team_id
  );

  const selectedTeam = useMemo(
    () => getTeamById(selectedTeamId) ?? TEAMS[0],
    [selectedTeamId]
  );

  // Build a quick summary across the bye window for the selected team.
  const summary = useMemo(() => {
    return BYE_ROUNDS.map((round) => {
      const row = data.impactByRound[round].find((r) => r.team.team_id === selectedTeamId);
      return {
        round,
        unavailable: row?.unavailable.length ?? 0,
        rosterSize: row?.rosterSize ?? 0,
        pointsLost: row?.pointsLost ?? 0,
        grade: (row?.grade ?? 'none') as ImpactGrade,
        pointsGrade: (row?.pointsGrade ?? 'none') as PointsGrade,
      };
    });
  }, [data.impactByRound, selectedTeamId]);

  if (data.loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading your bye outlook…</div>;
  }

  if (!data.hasRosters) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-900 text-sm">
        No roster data uploaded yet — your impact will populate once a Points Grid is uploaded.
      </div>
    );
  }

  const teamColor = TEAM_COLOR_MAP[selectedTeamId] ?? '#6B7280';

  return (
    <div className="space-y-5">
      {/* Team picker */}
      <div className="bg-card border border-border rounded-lg shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="w-3 h-3 rounded-full shrink-0" style={{ background: teamColor }} />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Viewing</p>
            <p className="text-sm font-bold truncate" style={{ color: teamColor }}>
              {selectedTeam.team_name}
              <span className="text-muted-foreground font-normal ml-2">— {selectedTeam.coach}</span>
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="team-picker" className="text-xs text-muted-foreground">
            Switch team
          </label>
          <select
            id="team-picker"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(Number(e.target.value))}
            className="text-sm bg-card border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {TEAMS.map((t) => (
              <option key={t.team_id} value={t.team_id}>
                {t.team_name} ({t.coach})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary strip — five round chips */}
      <div className="bg-card border border-border rounded-lg shadow-sm p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Bye-window outlook
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {summary.map((s) => {
            const meta = IMPACT_META[s.grade];
            const ptsMeta = POINTS_META[s.pointsGrade];
            return (
              <div
                key={s.round}
                className="rounded-lg border border-border overflow-hidden"
                style={{ borderLeft: `4px solid ${meta.bg}` }}
              >
                <div className="px-3 py-2 bg-card space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-bold tabular-nums">R{s.round}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: meta.bg, color: meta.fg }}
                      title="Roster impact"
                    >
                      {meta.label}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {s.unavailable}/{s.rosterSize || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: ptsMeta.bg, color: ptsMeta.fg }}
                      title="Scoring impact"
                    >
                      {ptsMeta.label}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {s.pointsLost} pts
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-round detail, filtered to selected team */}
      <div className="space-y-5">
        {BYE_ROUNDS.map((round) => (
          <RoundImpactCard
            key={round}
            round={round}
            ladder={data.impactByRound[round]}
            filterTeamId={selectedTeamId}
          />
        ))}
      </div>

      {/* Caveats */}
      <p className="text-[10px] text-muted-foreground px-1">
        Unavailable = AFL bye <em>or</em> AFL injury feed predicts the player out that round.
        {data.latestRound ? ` Roster as of R${data.latestRound}.` : ''}
        {data.injuryFreshness ? ` Injury feed: ${new Date(data.injuryFreshness).toLocaleDateString()}.` : ''}
      </p>
    </div>
  );
}
