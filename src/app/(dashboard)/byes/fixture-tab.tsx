'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, HeartPulse } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TEAM_COLOR_MAP, TEAM_SHORT_NAMES } from '@/lib/team-colors';
import { AFL_CLUBS } from '@/lib/afl-clubs';
import {
  AFL_CLUB_BYES,
  BYE_ROUNDS,
  IMPACT_META,
  getByeRule,
  type ByeRound,
} from '@/lib/afl-club-byes';
import { LOMAF_BYE_FIXTURE } from '@/lib/lomaf-bye-fixture';
import { cn } from '@/lib/utils';
import { ClubBadge } from './round-impact-card';
import type { ByeData } from './use-bye-data';
import type { CoachRoundImpact } from './types';

interface MatchupRow {
  round_number: number;
  team_id: number;
  opp_id: number | null;
}

interface FixturePair {
  a: CoachRoundImpact;
  b: CoachRoundImpact;
}

export default function FixtureTab({ data }: { data: ByeData }) {
  const [fixtures, setFixtures] = useState<Record<ByeRound, MatchupRow[]>>({
    12: [], 13: [], 14: [], 15: [], 16: [],
  });
  const [fixturesLoading, setFixturesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: rows } = await supabase
          .from('matchup_rounds')
          .select('round_number, team_id, opp_id')
          .in('round_number', BYE_ROUNDS as unknown as number[]);
        if (cancelled || !rows) return;
        const next: Record<ByeRound, MatchupRow[]> = { 12: [], 13: [], 14: [], 15: [], 16: [] };
        for (const r of rows) {
          if ((BYE_ROUNDS as readonly number[]).includes(r.round_number)) {
            next[r.round_number as ByeRound].push(r as MatchupRow);
          }
        }
        setFixtures(next);
      } catch (err) {
        console.error('Failed to load matchup fixtures for byes:', err);
      } finally {
        if (!cancelled) setFixturesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loading = data.loading || fixturesLoading;

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading fixture…</div>;
  }

  return (
    <>
      {/* Quick-jump strip — anchors to each round so you can flip between
          rounds without scrolling through the page. */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 px-4 py-2 bg-background/95 backdrop-blur border-b border-border flex flex-wrap gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground self-center">
          Jump to:
        </span>
        {BYE_ROUNDS.map((round) => (
          <a
            key={round}
            href={`#round-${round}`}
            className="text-xs font-semibold px-2.5 py-1 rounded-full bg-muted text-foreground hover:bg-muted/70 transition-colors"
          >
            R{round}
          </a>
        ))}
      </div>

      <div className="space-y-6">
        {BYE_ROUNDS.map((round) => {
          // Prefer DB-uploaded matchups so post-play data (with scores) wins
          // once the matchups CSV is uploaded for these rounds. Fall back to
          // the static LOMAF_BYE_FIXTURE so the tab is useful immediately.
          const dbPairs = pairFromDb(fixtures[round], data.impactByRound[round]);
          const pairs = dbPairs.length > 0
            ? dbPairs
            : pairFromStatic(round, data.impactByRound[round]);
          return <FixtureRoundCard key={round} round={round} pairs={pairs} />;
        })}
      </div>
    </>
  );
}

function pairFromDb(
  matchups: MatchupRow[],
  ladder: CoachRoundImpact[],
): FixturePair[] {
  const impactByTeam = new Map(ladder.map((r) => [r.team.team_id, r] as const));
  const seen = new Set<number>();
  const pairs: FixturePair[] = [];
  for (const m of matchups) {
    if (seen.has(m.team_id) || m.opp_id == null || seen.has(m.opp_id)) continue;
    const a = impactByTeam.get(m.team_id);
    const b = impactByTeam.get(m.opp_id);
    if (!a || !b) continue;
    pairs.push({ a, b });
    seen.add(m.team_id);
    seen.add(m.opp_id);
  }
  return pairs;
}

function pairFromStatic(
  round: ByeRound,
  ladder: CoachRoundImpact[],
): FixturePair[] {
  const impactByTeam = new Map(ladder.map((r) => [r.team.team_id, r] as const));
  const pairs: FixturePair[] = [];
  for (const [aId, bId] of LOMAF_BYE_FIXTURE[round]) {
    const a = impactByTeam.get(aId);
    const b = impactByTeam.get(bId);
    if (a && b) pairs.push({ a, b });
  }
  return pairs;
}

function FixtureRoundCard({ round, pairs }: { round: ByeRound; pairs: FixturePair[] }) {
  const clubs = AFL_CLUB_BYES[round];
  const rule = getByeRule(round);
  const isBest16 = rule === 'best-16';

  return (
    <section
      id={`round-${round}`}
      className="bg-card border border-border rounded-lg shadow-sm overflow-hidden scroll-mt-20"
    >
      {/* Compact round header — round number, rule chip, bye clubs all on
          one strip so the matchups dominate the card body. */}
      <header className="px-5 py-3 border-b border-border bg-muted/10 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-lg font-bold tabular-nums">Round {round}</h2>
        <span
          className={cn(
            'text-[11px] font-semibold px-2 py-0.5 rounded-full',
            isBest16 ? 'bg-[#1A56DB] text-white' : 'bg-muted text-muted-foreground'
          )}
        >
          {isBest16 ? 'Best 16' : 'Play normally'}
        </span>
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Bye:
          </span>
          {clubs.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 text-[11px] font-medium"
              title={AFL_CLUBS[code]?.name ?? code}
            >
              <ClubBadge code={code} size={18} />
            </span>
          ))}
        </div>
      </header>

      {/* Matchups — one wide row per matchup, no two-column squeeze. */}
      <ul className="divide-y divide-border">
        {pairs.map((pair) => (
          <FixtureRow key={`${pair.a.team.team_id}-${pair.b.team.team_id}`} pair={pair} />
        ))}
      </ul>
    </section>
  );
}

function FixtureRow({ pair }: { pair: FixturePair }) {
  const [expanded, setExpanded] = useState(false);
  const totalUnavailable = pair.a.unavailable.length + pair.b.unavailable.length;
  const canExpand = totalUnavailable > 0;

  // Worse impact gets visual weight in the divider so coaches can scan
  // for one-sided matchups at a glance.
  const delta = Math.abs(pair.a.unavailable.length - pair.b.unavailable.length);
  const heavier =
    pair.a.unavailable.length > pair.b.unavailable.length ? 'a'
    : pair.b.unavailable.length > pair.a.unavailable.length ? 'b'
    : null;

  return (
    <li>
      <button
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        className={cn(
          'w-full text-left px-4 py-3 transition-colors',
          canExpand ? 'hover:bg-muted/20 cursor-pointer' : 'cursor-default'
        )}
      >
        <div className="flex flex-col gap-2">
          <CoachInline row={pair.a} accentSide={heavier === 'a'} />

          <div className="flex items-center gap-2 pl-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              vs
            </span>
            <span className="h-px flex-1 bg-border" />
            {delta > 0 ? (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {delta}-player gap
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                even
              </span>
            )}
            {canExpand && (
              expanded
                ? <ChevronDown size={14} className="text-muted-foreground" />
                : <ChevronRight size={14} className="text-muted-foreground" />
            )}
          </div>

          <CoachInline row={pair.b} accentSide={heavier === 'b'} />
        </div>
      </button>

      {canExpand && expanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 border-t border-border/50">
          <UnavailableList row={pair.a} />
          <UnavailableList row={pair.b} divider />
        </div>
      )}
    </li>
  );
}

function CoachInline({
  row,
  accentSide,
}: {
  row: CoachRoundImpact;
  /** When true, this row's grade is the worse of the pair — bumps font weight on the pill. */
  accentSide: boolean;
}) {
  const teamColor = TEAM_COLOR_MAP[row.team.team_id] ?? '#6B7280';
  const meta = IMPACT_META[row.grade];
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span
        aria-hidden
        className="w-3 h-3 rounded-full shrink-0"
        style={{ background: teamColor }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold truncate" style={{ color: teamColor }}>
          {TEAM_SHORT_NAMES[row.team.team_id] ?? row.team.team_name}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {row.team.team_name}
        </div>
      </div>
      <span
        className={cn(
          'text-[11px] px-2.5 py-1 rounded-full shrink-0 tabular-nums',
          accentSide ? 'font-bold ring-2 ring-offset-1 ring-current/20' : 'font-semibold'
        )}
        style={{ background: meta.bg, color: meta.fg }}
      >
        {meta.label}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-14 text-right">
        {row.unavailable.length}/{row.rosterSize || '—'}
      </span>
    </div>
  );
}

function UnavailableList({
  row,
  divider = false,
}: {
  row: CoachRoundImpact;
  /** When true, render a divider against the previous panel (right side on desktop). */
  divider?: boolean;
}) {
  const teamColor = TEAM_COLOR_MAP[row.team.team_id] ?? '#6B7280';
  return (
    <div className={cn('px-4 py-3 bg-muted/10', divider && 'sm:border-l border-border/50')}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: teamColor }}>
        {TEAM_SHORT_NAMES[row.team.team_id] ?? row.team.team_name}
        <span className="text-muted-foreground font-medium normal-case tracking-normal ml-1.5">
          — {row.unavailable.length} unavailable
        </span>
      </p>
      {row.unavailable.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">Full squad available.</p>
      ) : (
        <ul className="space-y-1">
          {row.unavailable.map((p) => (
            <li key={p.player_id} className="flex items-center gap-2 text-[11px] leading-snug">
              <ClubBadge code={p.club} size={16} />
              <span className="truncate flex-1">{p.player_name}</span>
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
          ))}
        </ul>
      )}
    </div>
  );
}
