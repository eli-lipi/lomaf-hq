'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { TEAM_COLOR_MAP, TEAM_SHORT_NAMES } from '@/lib/team-colors';
import { AFL_CLUBS } from '@/lib/afl-clubs';
import {
  AFL_CLUB_BYES,
  BYE_ROUNDS,
  getByeRule,
  getImpactGrade,
  IMPACT_META,
  IMPACT_GRADES_ORDERED,
} from '@/lib/afl-club-byes';
import { cn } from '@/lib/utils';

interface PlayerClub {
  team_id: number;
  player_id: number;
  player_name: string;
  club: string;
}

function ClubBadge({ code, size = 28 }: { code: string; size?: number }) {
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

export default function ByesClient() {
  const [data, setData] = useState<PlayerClub[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasClubData, setHasClubData] = useState(false);
  const [latestRound, setLatestRound] = useState<number>(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: roundCheck } = await supabase
          .from('player_rounds')
          .select('round_number')
          .order('round_number', { ascending: false })
          .limit(1);
        if (!roundCheck || roundCheck.length === 0) {
          if (!cancelled) setLoading(false);
          return;
        }
        const maxRound = roundCheck[0].round_number;
        if (!cancelled) setLatestRound(maxRound);

        const allRows: PlayerClub[] = [];
        let offset = 0;
        while (true) {
          const { data: batch } = await supabase
            .from('player_rounds')
            .select('team_id, player_id, player_name, club')
            .eq('round_number', maxRound)
            .range(offset, offset + 999);
          if (!batch || batch.length === 0) break;
          for (const row of batch) {
            if (row.club && AFL_CLUBS[row.club]) {
              allRows.push({
                team_id: row.team_id,
                player_id: row.player_id,
                player_name: row.player_name,
                club: row.club,
              });
            }
          }
          if (batch.length < 1000) break;
          offset += 1000;
        }

        if (!cancelled) {
          setHasClubData(allRows.length > 0);
          setData(allRows);
        }
      } catch (err) {
        console.error('Failed to load roster data for byes:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Group players by (team_id, club) so we can compute per-coach bye impact.
  const playersByTeamClub = useMemo(() => {
    const m = new Map<string, { player_id: number; player_name: string }[]>();
    for (const row of data) {
      const key = `${row.team_id}-${row.club}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push({ player_id: row.player_id, player_name: row.player_name });
    }
    return m;
  }, [data]);

  // Roster size per LOMAF team (from the latest snapshot). Used to grade
  // "Can't Field a Team" — falls back to ROSTER_SIZE if a team isn't in data.
  const rosterSizeByTeam = useMemo(() => {
    const m = new Map<number, number>();
    for (const row of data) {
      m.set(row.team_id, (m.get(row.team_id) ?? 0) + 1);
    }
    return m;
  }, [data]);

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Byes</h1>
        <p className="text-muted-foreground text-sm mt-1">
          AFL bye fixture for the 2026 season (R12–R16). When 2 AFL clubs bye we play normally;
          when 4 bye we play <span className="font-semibold text-foreground">best 16</span> — top
          16 scores from each coach&apos;s full list, no positions or bench.
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading bye schedule…</div>
      ) : (
        <div className="space-y-5">
          {BYE_ROUNDS.map((round) => {
            const clubs = AFL_CLUB_BYES[round];
            const rule = getByeRule(round);
            const isBest16 = rule === 'best-16';

            // Coach impact: count and list each LOMAF coach's players whose
            // club is on bye, then grade by severity (worst → best). The
            // grade respects the round's scoring rule — best-16 needs 16
            // playable, normal needs 18, so "Can't Field a Team" kicks in
            // at different bye counts depending on the rule.
            const coachImpact = TEAMS.map((team) => {
              const players: { player_id: number; player_name: string; club: string }[] = [];
              for (const code of clubs) {
                const list = playersByTeamClub.get(`${team.team_id}-${code}`) ?? [];
                for (const p of list) players.push({ ...p, club: code });
              }
              const rosterSize = rosterSizeByTeam.get(team.team_id) ?? 0;
              const grade = getImpactGrade(players.length, rosterSize, rule);
              return { team, players, rosterSize, grade };
            }).sort((a, b) => {
              // Ladder order: worst impact at the top. Tiebreak on raw bye
              // count, then alphabetical so the order is deterministic.
              const o = IMPACT_META[a.grade].ordinal - IMPACT_META[b.grade].ordinal;
              if (o !== 0) return o;
              if (b.players.length !== a.players.length) return b.players.length - a.players.length;
              return a.team.team_name.localeCompare(b.team.team_name);
            });

            const totalImpacted = coachImpact.reduce((s, x) => s + x.players.length, 0);

            return (
              <section
                key={round}
                className="bg-card border border-border rounded-lg shadow-sm overflow-hidden"
              >
                {/* Round header */}
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
                      isBest16
                        ? 'bg-[#1A56DB] text-white'
                        : 'bg-muted text-muted-foreground'
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
                        <span className="text-sm font-medium">
                          {AFL_CLUBS[code]?.name ?? code}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Coach impact */}
                <div className="px-5 py-4">
                  <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Coach impact
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {hasClubData ? (
                        <>
                          {totalImpacted} player{totalImpacted === 1 ? '' : 's'} affected across the league
                          {latestRound ? ` (rosters as of R${latestRound})` : ''}
                        </>
                      ) : (
                        <>No roster data uploaded yet — coach impact will populate once a Points Grid is uploaded.</>
                      )}
                    </p>
                  </div>

                  {hasClubData ? (
                    <ol className="space-y-2">
                      {coachImpact.map(({ team, players, rosterSize, grade }, i) => {
                        const teamColor = TEAM_COLOR_MAP[team.team_id] ?? '#6B7280';
                        const meta = IMPACT_META[grade];
                        const key = `${round}-${team.team_id}`;
                        const isExpanded = !!expanded[key];
                        const hasPlayers = players.length > 0;
                        return (
                          <li
                            key={team.team_id}
                            className="bg-card border border-border rounded-lg overflow-hidden transition-shadow hover:shadow-sm"
                            style={{
                              borderLeft: `4px solid ${meta.bg}`,
                              background: `linear-gradient(90deg, ${meta.tint} 0%, transparent 35%)`,
                            }}
                          >
                            <button
                              onClick={() => hasPlayers && toggle(key)}
                              disabled={!hasPlayers}
                              className={cn(
                                'w-full flex items-center gap-3 px-3 py-2.5 text-left',
                                hasPlayers ? 'hover:bg-muted/20 cursor-pointer' : 'cursor-default'
                              )}
                            >
                              {/* Ladder rank */}
                              <span className="text-xs font-bold tabular-nums text-muted-foreground/70 w-5 shrink-0 text-right">
                                {i + 1}
                              </span>

                              {/* Coach color dot + name */}
                              <span
                                aria-hidden
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ background: teamColor }}
                              />
                              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                                <span className="text-sm font-bold truncate" style={{ color: teamColor }}>
                                  {TEAM_SHORT_NAMES[team.team_id] ?? team.team_name}
                                </span>
                                <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
                                  {team.team_name}
                                </span>
                              </div>

                              {/* Impact grade pill */}
                              <span
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                                style={{ background: meta.bg, color: meta.fg }}
                              >
                                {meta.label}
                              </span>

                              {/* Bye count of roster */}
                              <span className="text-[11px] tabular-nums text-muted-foreground shrink-0 hidden sm:inline">
                                {players.length}/{rosterSize || '—'} byed
                              </span>

                              {/* Expand chevron */}
                              {hasPlayers ? (
                                isExpanded ? (
                                  <ChevronDown size={16} className="text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                                )
                              ) : (
                                <span className="w-4 shrink-0" />
                              )}
                            </button>
                            {hasPlayers && isExpanded && (
                              <ul className="px-3 pb-3 pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 border-t border-border/50">
                                {players.map((p) => (
                                  <li
                                    key={p.player_id}
                                    className="flex items-center gap-2 text-xs leading-snug"
                                  >
                                    <ClubBadge code={p.club} size={16} />
                                    <span className="truncate">{p.player_name}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Legend — explains the colour scale used on every round's ladder */}
      {!loading && (
        <div className="mt-6 bg-card border border-border rounded-lg shadow-sm px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
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
          <p className="text-[10px] text-muted-foreground mt-2">
            &quot;Can&apos;t Field a Team&quot; means a coach&apos;s playable roster after byes drops below the
            scoring minimum (16 in best-16 rounds, 18 in normal rounds).
          </p>
        </div>
      )}
    </div>
  );
}
