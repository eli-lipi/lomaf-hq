'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, HeartPulse, Star } from 'lucide-react';
import { TEAM_COLOR_MAP, TEAM_SHORT_NAMES } from '@/lib/team-colors';
import { AFL_CLUBS } from '@/lib/afl-clubs';
import {
  AFL_CLUB_BYES,
  IMPACT_META,
  STAR_AVG_THRESHOLD,
  getByeRule,
  type ByeRound,
} from '@/lib/afl-club-byes';
import { cn } from '@/lib/utils';
import type { CoachRoundImpact } from './types';

export function ClubBadge({ code, size = 28 }: { code: string; size?: number }) {
  const club = AFL_CLUBS[code];
  const bg = club?.primary ?? '#6B7280';
  const fg = club?.text ?? '#FFFFFF';
  return (
    <span
      title={club?.name ?? code}
      style={{
        width: size, height: size, borderRadius: '50%',
        background: bg, color: fg,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.36), fontWeight: 800,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: '-0.02em', flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)',
      }}
    >
      {code}
    </span>
  );
}

interface Props {
  round: ByeRound;
  /** All ten coach rows, pre-sorted worst-first by the hook. */
  ladder: CoachRoundImpact[];
  /** When set, only this team_id is rendered (for the My Team tab). */
  filterTeamId?: number;
  /** Optional alternate header label (e.g., "Round 12 — your bye outlook"). */
  headerLabel?: string;
}

/**
 * The round-impact card used by the Overview and My Team tabs. Shows the
 * round's bye clubs + scoring rule, then a ranked ladder of coaches
 * graded by total unavailability (byes + predicted injuries).
 */
export function RoundImpactCard({ round, ladder, filterTeamId, headerLabel }: Props) {
  const clubs = AFL_CLUB_BYES[round];
  const rule = getByeRule(round);
  const isBest16 = rule === 'best-16';
  const visible = filterTeamId
    ? ladder.filter((row) => row.team.team_id === filterTeamId)
    : ladder;
  const totalImpacted = visible.reduce((s, x) => s + x.unavailable.length, 0);
  const totalPointsLost = visible.reduce((s, x) => s + x.pointsLost, 0);

  return (
    <section className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      {/* Round header */}
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold tabular-nums">
            {headerLabel ?? `Round ${round}`}
          </h2>
          <span className="text-xs text-muted-foreground">
            {clubs.length} {clubs.length === 1 ? 'club' : 'clubs'} on bye
          </span>
        </div>
        <span
          className={cn(
            'ml-auto text-xs font-semibold px-2.5 py-1 rounded-full',
            isBest16 ? 'bg-[#1A56DB] text-white' : 'bg-muted text-muted-foreground'
          )}
        >
          {isBest16 ? 'Best 16' : 'Play normally'}
        </span>
      </div>

      {/* Clubs on bye */}
      <div className="px-5 py-4 border-b border-border bg-muted/10">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Clubs on bye
        </p>
        <div className="flex flex-wrap gap-3">
          {clubs.map((code) => (
            <div
              key={code}
              className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2"
            >
              <ClubBadge code={code} size={28} />
              <span className="text-sm font-medium">{AFL_CLUBS[code]?.name ?? code}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Coach ladder */}
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {filterTeamId ? 'Your bye impact' : 'Coach impact ladder'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {totalImpacted} player{totalImpacted === 1 ? '' : 's'} unavailable
            {totalPointsLost > 0 ? ` · ${totalPointsLost} avg lost` : ''}
            {filterTeamId ? '' : ' across the league'}
          </p>
        </div>

        <ol className="space-y-2">
          {visible.map((row, i) => (
            <CoachLadderRow key={row.team.team_id} row={row} rank={i + 1} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function CoachLadderRow({ row, rank }: { row: CoachRoundImpact; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const teamColor = TEAM_COLOR_MAP[row.team.team_id] ?? '#6B7280';
  const meta = IMPACT_META[row.grade];
  const hasPlayers = row.unavailable.length > 0;

  return (
    <li
      className="bg-card border border-border rounded-lg overflow-hidden transition-shadow hover:shadow-sm"
      style={{
        borderLeft: `4px solid ${meta.bg}`,
        background: `linear-gradient(90deg, ${meta.tint} 0%, transparent 35%)`,
      }}
    >
      <button
        onClick={() => hasPlayers && setExpanded((v) => !v)}
        disabled={!hasPlayers}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 text-left',
          hasPlayers ? 'hover:bg-muted/20 cursor-pointer' : 'cursor-default'
        )}
      >
        <span className="text-xs font-bold tabular-nums text-muted-foreground/70 w-5 shrink-0 text-right">
          {rank}
        </span>
        <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: teamColor }} />
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-bold truncate" style={{ color: teamColor }}>
            {TEAM_SHORT_NAMES[row.team.team_id] ?? row.team.team_name}
          </span>
          <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
            {row.team.team_name}
          </span>
        </div>

        {/* Single combined grade pill + both raw numbers stacked beside it. */}
        <span
          className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
          style={{ background: meta.bg, color: meta.fg }}
          title={`${meta.label} — ${row.unavailable.length} out, ${row.pointsLost} pts lost`}
        >
          {meta.label}
        </span>
        <div className="flex flex-col items-end shrink-0 hidden sm:flex">
          <span className="text-[11px] tabular-nums text-muted-foreground tabular-nums">
            {row.unavailable.length}/{row.rosterSize || '—'} out
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {row.pointsLost} pts
          </span>
        </div>

        {hasPlayers ? (
          expanded ? (
            <ChevronDown size={16} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="w-4 shrink-0" />
        )}
      </button>
      {hasPlayers && expanded && (
        <ul className="px-3 pb-3 pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 border-t border-border/50">
          {row.unavailable.map((p) => {
            const isStar = p.avg != null && p.avg >= STAR_AVG_THRESHOLD;
            return (
              <li key={p.player_id} className="flex items-center gap-2 text-xs leading-snug">
                <ClubBadge code={p.club} size={16} />
                {isStar && (
                  <Star
                    size={11}
                    className="text-amber-500 shrink-0 fill-amber-400"
                    aria-label="Star player (100+ avg)"
                  />
                )}
                <span className="truncate flex-1">{p.player_name}</span>
                {p.avg != null && (
                  <span className="text-[10px] tabular-nums text-muted-foreground shrink-0 w-7 text-right">
                    {Math.round(p.avg)}
                  </span>
                )}
                {p.injured ? (
                  <span
                    title={p.byed ? 'Bye + predicted injured' : 'Predicted injured'}
                    className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-700"
                  >
                    <HeartPulse size={9} />
                    INJ
                  </span>
                ) : (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    BYE
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
