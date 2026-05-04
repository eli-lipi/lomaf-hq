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

type RoundMetricKey = `r${ByeRound}-players` | `r${ByeRound}-pts`;
type SortKey =
  | 'team'
  | 'totalOpp'
  | 'totalPts'
  | 'edge'
  | RoundMetricKey;
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

function roundPlayersKey(round: ByeRound): `r${ByeRound}-players` {
  return `r${round}-players`;
}
function roundPtsKey(round: ByeRound): `r${ByeRound}-pts` {
  return `r${round}-pts`;
}

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
          // Per-round sort key shape: `r{round}-{players|pts}`.
          const m = /^r(\d+)-(players|pts)$/.exec(sortKey);
          if (m) {
            const round = Number(m[1]) as ByeRound;
            const metric = m[2] as 'players' | 'pts';
            const av = metric === 'players'
              ? (a.perRound[round]?.count ?? -1)
              : (a.perRound[round]?.pointsLost ?? -1);
            const bv = metric === 'players'
              ? (b.perRound[round]?.count ?? -1)
              : (b.perRound[round]?.pointsLost ?? -1);
            primary = av - bv;
          }
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
            {/* Top row: round group labels (each spans two sub-cells).
                The non-round columns rowSpan=2 so they reach into the
                second header row. */}
            <tr className="border-b border-border/50 bg-muted/30">
              <Th label="Coach" sortKey="team" current={sortKey} dir={sortDir} onClick={toggleSort} align="left" rowSpan={2} />
              <Th
                label="Total Opp Out"
                sublabel="players · all 5 byes"
                icon={<Users size={12} />}
                sortKey="totalOpp"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                align="center"
                rowSpan={2}
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
                rowSpan={2}
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
                rowSpan={2}
              />
              {BYE_ROUNDS.map((round) => (
                <th
                  key={round}
                  colSpan={2}
                  className="px-2 pt-2.5 pb-1 text-center text-[12px] font-bold text-foreground border-l border-border/40"
                >
                  R{round}
                </th>
              ))}
            </tr>
            {/* Sub-row: per-round Players / Pts sort buttons. */}
            <tr className="border-b border-border bg-muted/30">
              {BYE_ROUNDS.map((round) => (
                <RoundSubHeaders
                  key={round}
                  round={round}
                  current={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
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

                  {/* Per-round: two adjacent colored cells (Players + Pts),
                      each independently sortable. The Players cell carries
                      the small "vs X" label so the opponent context is
                      preserved without doubling up. Cell colours: Players
                      uses the count-grade, Pts uses the points-grade. */}
                  {BYE_ROUNDS.map((round) => {
                    const cell = row.perRound[round];
                    if (!cell) {
                      return (
                        <td
                          key={`${round}-empty`}
                          colSpan={2}
                          className="px-2 py-3 text-center text-muted-foreground border-l border-border/40"
                        >
                          —
                        </td>
                      );
                    }
                    const countMeta = IMPACT_META[cell.grade];
                    const ptsMeta = POINTS_META[cell.pointsGrade];
                    return (
                      <RoundDataCells
                        key={round}
                        round={round}
                        cell={cell}
                        countMeta={countMeta}
                        ptsMeta={ptsMeta}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground px-1">
        Per-round group: <strong>Players</strong> cell (count-graded) on the left,
        <strong> Pts</strong> cell (points-graded) on the right — sort either independently.
        A 2-player cell with a star going down may show Low Players but Big Hit pts.
        Edge Rounds counts bye rounds where you&apos;re strictly more available than your opponent
        (ties don&apos;t count).
      </p>
    </div>
  );
}

/** Two sub-headers for a single round group: "Players" and "Pts", both
 *  independently sortable. Rendered as part of the second header row. */
function RoundSubHeaders({
  round,
  current,
  dir,
  onClick,
}: {
  round: ByeRound;
  current: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}) {
  const playersKey = roundPlayersKey(round);
  const ptsKey = roundPtsKey(round);
  return (
    <>
      <th className="px-2 pb-2 text-center border-l border-border/40">
        <SortBtn label="Players" sortKey={playersKey} current={current} dir={dir} onClick={onClick} />
      </th>
      <th className="px-2 pb-2 text-center">
        <SortBtn label="Pts" sortKey={ptsKey} current={current} dir={dir} onClick={onClick} />
      </th>
    </>
  );
}

/** A pair of body cells for one round: count-graded Players cell + points-graded Pts cell. */
function RoundDataCells({
  round,
  cell,
  countMeta,
  ptsMeta,
}: {
  round: ByeRound;
  cell: PerRoundCell;
  countMeta: { bg: string; fg: string; label: string };
  ptsMeta: { bg: string; fg: string; label: string };
}) {
  return (
    <>
      <td
        className="px-2 py-2 text-center align-middle border-l border-border/40"
        title={`R${round}: vs ${cell.oppShortName} — ${countMeta.label} (${cell.count} unavailable)`}
      >
        <div
          className="rounded-md py-1.5 px-1 leading-tight font-bold"
          style={{ background: countMeta.bg, color: countMeta.fg }}
        >
          <div className="text-base tabular-nums">{cell.count}</div>
          <div className="text-[9px] uppercase tracking-wider opacity-80 truncate">
            vs {cell.oppShortName}
          </div>
        </div>
      </td>
      <td
        className="px-2 py-2 text-center align-middle"
        title={`R${round}: vs ${cell.oppShortName} — ${ptsMeta.label} (${cell.pointsLost} avg lost)`}
      >
        <div
          className="rounded-md py-1.5 px-1 leading-tight font-bold"
          style={{ background: ptsMeta.bg, color: ptsMeta.fg }}
        >
          <div className="text-base tabular-nums">{cell.pointsLost}</div>
          <div className="text-[9px] uppercase tracking-wider opacity-80 truncate">
            avg lost
          </div>
        </div>
      </td>
    </>
  );
}

/** Compact sort button used inside the per-round sub-header cells. */
function SortBtn({
  label,
  sortKey,
  current,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}) {
  const isActive = current === sortKey;
  return (
    <button
      onClick={() => onClick(sortKey)}
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider hover:text-foreground transition-colors',
        isActive ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      <span>{label}</span>
      {isActive ? (
        dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
      ) : (
        <ArrowUpDown size={10} className="opacity-40" />
      )}
    </button>
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
  rowSpan,
}: {
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  align: 'left' | 'center';
  /** When provided, the cell spans both header rows so it sits beside the
   *  per-round grouped columns. */
  rowSpan?: number;
}) {
  const isActive = current === sortKey;
  return (
    <th
      rowSpan={rowSpan}
      className={cn(
        'px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground select-none align-middle',
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
