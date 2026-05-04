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
    <div className="space-y-5">
      {BYE_ROUNDS.map((round) => {
        const pairs = pairFixtures(fixtures[round], data.impactByRound[round]);
        return <FixtureRoundCard key={round} round={round} pairs={pairs} />;
      })}
    </div>
  );
}

function pairFixtures(
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

function FixtureRoundCard({ round, pairs }: { round: ByeRound; pairs: FixturePair[] }) {
  const clubs = AFL_CLUB_BYES[round];
  const rule = getByeRule(round);
  const isBest16 = rule === 'best-16';

  return (
    <section className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold tabular-nums">Round {round}</h2>
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

      <div className="px-5 py-4 border-b border-border bg-muted/10">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Clubs on bye
        </p>
        <div className="flex flex-wrap gap-2">
          {clubs.map((code) => (
            <div
              key={code}
              className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1"
            >
              <ClubBadge code={code} size={20} />
              <span className="text-xs font-medium">{AFL_CLUBS[code]?.name ?? code}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
          LOMAF fixture
        </p>
        {pairs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No matchups uploaded for R{round} yet — upload the matchups CSV to populate the fixture.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {pairs.map((pair) => (
              <FixtureRow key={`${pair.a.team.team_id}-${pair.b.team.team_id}`} pair={pair} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FixtureRow({ pair }: { pair: FixturePair }) {
  const [expanded, setExpanded] = useState(false);
  const hasUnavailable = pair.a.unavailable.length + pair.b.unavailable.length > 0;
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => hasUnavailable && setExpanded((v) => !v)}
        disabled={!hasUnavailable}
        className={cn(
          'w-full grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2.5',
          hasUnavailable ? 'hover:bg-muted/20 cursor-pointer' : 'cursor-default'
        )}
      >
        <CoachSide row={pair.a} align="left" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">vs</span>
        <CoachSide row={pair.b} align="right" />
      </button>

      {hasUnavailable && (
        <div className="px-3 pb-2 -mt-1 flex items-center justify-end">
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded ? 'Hide' : 'Show'} unavailable players
          </span>
        </div>
      )}

      {hasUnavailable && expanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border-t border-border/50">
          <UnavailableList row={pair.a} side="left" />
          <UnavailableList row={pair.b} side="right" />
        </div>
      )}
    </div>
  );
}

function CoachSide({ row, align }: { row: CoachRoundImpact; align: 'left' | 'right' }) {
  const teamColor = TEAM_COLOR_MAP[row.team.team_id] ?? '#6B7280';
  const meta = IMPACT_META[row.grade];
  return (
    <div className={cn('flex items-center gap-2 min-w-0', align === 'right' && 'flex-row-reverse text-right')}>
      <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: teamColor }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold truncate" style={{ color: teamColor }}>
          {TEAM_SHORT_NAMES[row.team.team_id] ?? row.team.team_name}
        </div>
        <div className={cn('flex items-center gap-1.5 mt-1', align === 'right' && 'justify-end')}>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: meta.bg, color: meta.fg }}
          >
            {meta.label}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {row.unavailable.length}/{row.rosterSize || '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

function UnavailableList({ row, side }: { row: CoachRoundImpact; side: 'left' | 'right' }) {
  const teamColor = TEAM_COLOR_MAP[row.team.team_id] ?? '#6B7280';
  return (
    <div className={cn('px-3 py-2.5 bg-muted/10', side === 'right' && 'sm:border-l border-border/50')}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: teamColor }}>
        {TEAM_SHORT_NAMES[row.team.team_id] ?? row.team.team_name}
      </p>
      {row.unavailable.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">Full squad available.</p>
      ) : (
        <ul className="space-y-1">
          {row.unavailable.map((p) => (
            <li key={p.player_id} className="flex items-center gap-1.5 text-[11px] leading-snug">
              <ClubBadge code={p.club} size={14} />
              <span className="truncate flex-1">{p.player_name}</span>
              {p.injured && (
                <HeartPulse size={10} className="text-rose-600 shrink-0" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

