'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { TEAM_COLOR_MAP, TEAM_SHORT_NAMES } from '@/lib/team-colors';
import { AFL_CLUBS } from '@/lib/afl-clubs';
import { AFL_CLUB_BYES, BYE_ROUNDS, getByeRule } from '@/lib/afl-club-byes';
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

            // Coach impact: count and list each LOMAF coach's players whose club is on bye.
            const coachImpact = TEAMS.map((team) => {
              const players: { player_id: number; player_name: string; club: string }[] = [];
              for (const code of clubs) {
                const list = playersByTeamClub.get(`${team.team_id}-${code}`) ?? [];
                for (const p of list) players.push({ ...p, club: code });
              }
              return { team, players };
            }).sort((a, b) => b.players.length - a.players.length);

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
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                      {coachImpact.map(({ team, players }) => {
                        const teamColor = TEAM_COLOR_MAP[team.team_id] ?? '#6B7280';
                        const key = `${round}-${team.team_id}`;
                        const isExpanded = !!expanded[key];
                        const hasPlayers = players.length > 0;
                        return (
                          <div
                            key={team.team_id}
                            className="bg-card border border-border rounded-lg overflow-hidden"
                            style={{ borderLeft: `3px solid ${teamColor}` }}
                          >
                            <button
                              onClick={() => hasPlayers && toggle(key)}
                              disabled={!hasPlayers}
                              className={cn(
                                'w-full flex items-center justify-between gap-2 p-3 text-left',
                                hasPlayers ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {hasPlayers ? (
                                  isExpanded ? (
                                    <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                                  ) : (
                                    <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                                  )
                                ) : (
                                  <span className="w-3.5 shrink-0" />
                                )}
                                <span
                                  className="text-xs font-bold truncate"
                                  style={{ color: teamColor }}
                                >
                                  {TEAM_SHORT_NAMES[team.team_id] ?? team.team_name}
                                </span>
                              </div>
                              <span
                                className={cn(
                                  'text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full shrink-0',
                                  hasPlayers ? '' : 'opacity-40'
                                )}
                                style={{
                                  background: `${teamColor}1A`,
                                  color: teamColor,
                                }}
                              >
                                × {players.length}
                              </span>
                            </button>
                            {hasPlayers && isExpanded && (
                              <ul className="px-3 pb-3 pt-0 space-y-1 border-t border-border/50">
                                {players.map((p) => (
                                  <li
                                    key={p.player_id}
                                    className="flex items-center gap-2 text-xs leading-snug pt-1.5"
                                  >
                                    <ClubBadge code={p.club} size={16} />
                                    <span className="truncate">{p.player_name}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
