'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Coins, TrendingUp, Users } from 'lucide-react';
import { TEAMS } from '@/lib/constants';
import { TEAM_COLOR_MAP, TEAM_SHORT_NAMES } from '@/lib/team-colors';
import {
  BYE_ROUNDS,
  IMPACT_META,
  POINTS_META,
  type ByeRound,
  type ImpactGrade,
  type PointsGrade,
} from '@/lib/afl-club-byes';
import { cn } from '@/lib/utils';
import type { ByeData } from './use-bye-data';

type SortKey =
  | 'team'
  | 'totalOpp'
  | 'totalPts'
  | 'edge'
  | 'r12' | 'r13' | 'r14' | 'r15' | 'r16';
type SortDir = 'asc' | 'desc';

interface PerRoundCell {
  count: number;
  pointsLost: number;
  grade: ImpactGrade;
  pointsGrade: PointsGrade;
  oppTeamId: number;
  oppShortName: string;
}

interface OppositionRow {
  teamId: number;
  teamName: string;
  shortName: string;
  /** Sum of opponent unavailable counts across all 5 bye rounds. Higher = your opponents are weakest. */
  totalOppUnavailable: number;
  /** Sum of opponent avg-points lost across all 5 bye rounds. */
  totalOppPointsLost: number;
  /** Number of bye rounds where coach has strictly fewer unavailable players than their opponent. */
  edgeRounds: number;
  /** Per-round opponent stats. `null` if the opponent isn't resolvable for that round. */
  perRound: Record<ByeRound, PerRoundCell | null>;
}

const ROUND_KEYS: Record<ByeRound, Extract<SortKey, `r${number}`>> = {
  12: 'r12', 13: 'r13', 14: 'r14', 15: 'r15', 16: 'r16',
};

export default function OppositionTab({ data }: { data: ByeData }) {
  // Default sort: most opp pain first — this is the "best case for me" lens.
  const [sortKey, setSortKey] = useState<SortKey>('totalOpp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const rows = useMemo<OppositionRow[]>(() => {
    return TEAMS.map((team) => {
      let totalOppUnavailable = 0;
      let totalOppPointsLost = 0;
      let edgeRounds = 0;
      const perRound: Record<ByeRound, PerRoundCell | null> = {
        12: null, 13: null, 14: null, 15: null, 16: null,
      };

      for (const round of BYE_ROUNDS) {
        const ladder = data.impactByRound[round];
        const oppId = data.opponentByRound[round].get(team.team_id);
        const myImpact = ladder.find((r) => r.team.team_id === team.team_id);
        const oppImpact = oppId
          ? ladder.find((r) => r.team.team_id === oppId)
          : null;

        if (oppImpact) {
          const count = oppImpact.unavailable.length;
          totalOppUnavailable += count;
          totalOppPointsLost += oppImpact.pointsLost;
          perRound[round] = {
            count,
            pointsLost: oppImpact.pointsLost,
            grade: oppImpact.grade,
            pointsGrade: oppImpact.pointsGrade,
            oppTeamId: oppImpact.team.team_id,
            oppShortName: TEAM_SHORT_NAMES[oppImpact.team.team_id] ?? oppImpact.team.team_name,
          };
          if (myImpact && myImpact.unavailable.length < count) {
            edgeRounds += 1;
          }
        }
      }

      return {
        teamId: team.team_id,
        teamName: team.team_name,
        shortName: TEAM_SHORT_NAMES[team.team_id] ?? team.team_name,
        totalOppUnavailable,
        totalOppPointsLost,
        edgeRounds,
        perRound,
      };
    });
  }, [data.impactByRound, data.opponentByRound]);

  const sortedRows = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let primary = 0;
      switch (sortKey) {
        case 'team':
          primary = a.teamName.localeCompare(b.teamName);
          break;
        case 'totalOpp':
          primary = a.totalOppUnavailable - b.totalOppUnavailable;
          break;
        case 'totalPts':
          primary = a.totalOppPointsLost - b.totalOppPointsLost;
          break;
        case 'edge':
          primary = a.edgeRounds - b.edgeRounds;
          break;
        default: {
          // r12..r16 — sort by opp pointsLost (more meaningful than raw count
          // for the per-round columns, since a star bye matters more).
          const round = Number(sortKey.slice(1)) as ByeRound;
          const ac = a.perRound[round]?.pointsLost ?? -1;
          const bc = b.perRound[round]?.pointsLost ?? -1;
          primary = ac - bc;
        }
      }
      if (primary !== 0) return primary * direction;
      // Stable secondary sort: alphabetical by team name.
      return a.teamName.localeCompare(b.teamName);
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Default to descending for numeric columns (most pain at top),
      // ascending for the team column (alphabetical).
      setSortDir(key === 'team' ? 'asc' : 'desc');
    }
  };

  if (data.loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading opposition ladder…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-bold mb-1">Opposition ladder</h2>
        <p className="text-xs text-muted-foreground">
          Each row is your view of your <span className="font-semibold text-foreground">opponents&apos;</span> bye-window pain.
          Higher numbers = your opponents are weakest. Sort by any column.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <Th label="Coach" sortKey="team" current={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
              <Th
                label="Total Opp Out"
                sublabel="players · all 5 byes"
                icon={<Users size={12} />}
                sortKey="totalOpp"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                align="center"
              />
              <Th
                label="Total Pts Lost"
                sublabel="opp avg · all 5 byes"
                icon={<Coins size={12} />}
                sortKey="totalPts"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                align="center"
              />
              <Th
                label="Edge Rounds"
                sublabel="you have advantage"
                icon={<TrendingUp size={12} />}
                sortKey="edge"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                align="center"
              />
              {BYE_ROUNDS.map((round) => (
                <Th
                  key={round}
                  label={`R${round}`}
                  sublabel="players · pts"
                  sortKey={ROUND_KEYS[round]}
                  current={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                  align="center"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const teamColor = TEAM_COLOR_MAP[row.teamId] ?? '#6B7280';
              return (
                <tr key={row.teamId} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
                  {/* Coach */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: teamColor }} />
                      <div className="min-w-0">
                        <div className="text-sm font-bold truncate" style={{ color: teamColor }}>
                          {row.shortName}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {row.teamName}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Total Opp Out (player count) */}
                  <td className="px-3 py-3 text-center">
                    <span className="text-base font-bold tabular-nums">{row.totalOppUnavailable}</span>
                  </td>

                  {/* Total Pts Lost (sum of opp avg) */}
                  <td className="px-3 py-3 text-center">
                    <span className="text-base font-bold tabular-nums">{row.totalOppPointsLost}</span>
                  </td>

                  {/* Edge Rounds */}
                  <td className="px-3 py-3 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center justify-center min-w-[2.25rem] px-2 py-0.5 rounded-full text-xs font-bold tabular-nums',
                        row.edgeRounds >= 3
                          ? 'bg-emerald-100 text-emerald-800'
                          : row.edgeRounds === 0
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {row.edgeRounds}/5
                    </span>
                  </td>

                  {/* Per-round opp counts — cell colour follows the
                      points-grade (more meaningful than count alone since
                      it weights starpower). Cell shows: opp player count
                      on top, opp avg lost beneath, opp short name below. */}
                  {BYE_ROUNDS.map((round) => {
                    const cell = row.perRound[round];
                    if (!cell) {
                      return (
                        <td key={round} className="px-2 py-3 text-center text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    const ptsMeta = POINTS_META[cell.pointsGrade];
                    const countMeta = IMPACT_META[cell.grade];
                    return (
                      <td
                        key={round}
                        className="px-2 py-2 text-center align-middle"
                        title={
                          `R${round}: vs ${cell.oppShortName}\n` +
                          `Roster: ${countMeta.label} (${cell.count} out)\n` +
                          `Scoring: ${ptsMeta.label} (${cell.pointsLost} avg lost)`
                        }
                      >
                        <div
                          className="rounded-md py-1.5 px-1 leading-tight font-bold"
                          style={{ background: ptsMeta.bg, color: ptsMeta.fg }}
                        >
                          <div className="flex items-center justify-center gap-1 text-sm tabular-nums">
                            <span>{cell.count}</span>
                            <span className="opacity-60 text-[10px]">·</span>
                            <span>{cell.pointsLost}</span>
                          </div>
                          <div className="text-[8px] uppercase tracking-wider opacity-80 truncate font-medium">
                            players · pts
                          </div>
                          <div className="text-[9px] uppercase tracking-wider opacity-80 truncate">
                            vs {cell.oppShortName}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground px-1">
        Per-round cells: <strong>players</strong> unavailable on the left, <strong>avg points lost</strong> on the right.
        Cell colour follows the points-weighted grade (No Hit · Light · Medium · Big · Crippling), so a 2-player cell
        with a star going down stays red. Edge Rounds counts bye rounds where you&apos;re strictly more available than your
        opponent (ties don&apos;t count).
      </p>
    </div>
  );
}

function Th({
  label,
  sublabel,
  icon,
  sortKey,
  current,
  dir,
  onClick,
  align,
}: {
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  align: 'left' | 'center';
}) {
  const isActive = current === sortKey;
  return (
    <th
      className={cn(
        'px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground select-none',
        align === 'center' ? 'text-center' : 'text-left'
      )}
    >
      <button
        onClick={() => onClick(sortKey)}
        className={cn(
          'inline-flex items-center gap-1.5 hover:text-foreground transition-colors',
          isActive && 'text-foreground'
        )}
      >
        {icon}
        <span className="flex flex-col leading-tight">
          <span>{label}</span>
          {sublabel && (
            <span className="text-[9px] font-medium normal-case tracking-normal text-muted-foreground/80">
              {sublabel}
            </span>
          )}
        </span>
        {isActive ? (
          dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
        ) : (
          <ArrowUpDown size={11} className="opacity-40" />
        )}
      </button>
    </th>
  );
}
