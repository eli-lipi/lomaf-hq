'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#1A56DB', 3194005: '#DC2626', 3194009: '#16A34A', 3194003: '#F59E0B',
  3194006: '#9333EA', 3194010: '#0891B2', 3194008: '#EA580C', 3194001: '#DB2777',
  3194004: '#4F46E5', 3194007: '#059669',
};

// AFL clubs — full names, primary brand colours, contrast text for badges.
interface AflClub { name: string; primary: string; text: string }
const AFL_CLUBS: Record<string, AflClub> = {
  ADE: { name: 'Adelaide Crows',    primary: '#002B5C', text: '#E21937' },
  BRL: { name: 'Brisbane Lions',    primary: '#A30046', text: '#FFCD00' },
  CAR: { name: 'Carlton',           primary: '#031A29', text: '#FFFFFF' },
  COL: { name: 'Collingwood',       primary: '#000000', text: '#FFFFFF' },
  ESS: { name: 'Essendon',          primary: '#CC2031', text: '#000000' },
  FRE: { name: 'Fremantle',         primary: '#2A0D54', text: '#FFFFFF' },
  GEE: { name: 'Geelong Cats',      primary: '#002B5C', text: '#FFFFFF' },
  GCS: { name: 'Gold Coast Suns',   primary: '#D71920', text: '#F8C20A' },
  GWS: { name: 'GWS Giants',        primary: '#F47B20', text: '#000000' },
  HAW: { name: 'Hawthorn',          primary: '#4D2004', text: '#FFC423' },
  MEL: { name: 'Melbourne',         primary: '#0F1131', text: '#CC2031' },
  NTH: { name: 'North Melbourne',   primary: '#013B9F', text: '#FFFFFF' },
  PTA: { name: 'Port Adelaide',     primary: '#01B2A9', text: '#000000' },
  RIC: { name: 'Richmond',          primary: '#000000', text: '#FFD200' },
  STK: { name: 'St Kilda',          primary: '#000000', text: '#ED1B2F' },
  SYD: { name: 'Sydney Swans',      primary: '#ED171F', text: '#FFFFFF' },
  WCE: { name: 'West Coast Eagles', primary: '#003087', text: '#F2A900' },
  WBD: { name: 'Western Bulldogs',  primary: '#014896', text: '#CC2031' },
};
const ALL_CLUB_CODES = Object.keys(AFL_CLUBS).sort((a, b) =>
  AFL_CLUBS[a].name.localeCompare(AFL_CLUBS[b].name)
);

function ClubBadge({ code, size = 26 }: { code: string; size?: number }) {
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
        fontSize: Math.round(size * 0.38), fontWeight: 800,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: '-0.02em', flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)',
      }}
    >
      {code}
    </span>
  );
}

function TeamDot({ teamId, size = 10 }: { teamId: number; size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: '50%',
        background: TEAM_COLOR_MAP[teamId] ?? '#9CA3AF',
        display: 'inline-block', flexShrink: 0,
      }}
    />
  );
}

interface PlayerClub {
  team_id: number;
  player_id: number;
  player_name: string;
  club: string;
}

export default function ConcentrationTab() {
  const [data, setData] = useState<PlayerClub[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasClubData, setHasClubData] = useState(false);
  const [latestRound, setLatestRound] = useState<number>(0);
  const [expandedClub, setExpandedClub] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'alpha' | 'popularity' | 'concentration'>('alpha');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const { data: roundCheck } = await supabase
        .from('player_rounds')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1);
      if (!roundCheck || roundCheck.length === 0) { setLoading(false); return; }
      const maxRound = roundCheck[0].round_number;
      setLatestRound(maxRound);

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

      setHasClubData(allRows.length > 0);
      setData(allRows);
    } catch (err) {
      console.error('Failed to load concentration data:', err);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    // (team_id, club) → count
    const countMap = new Map<string, number>();
    // club → { team_id → players[] }
    const clubTeamPlayers = new Map<string, Map<number, { player_id: number; player_name: string }[]>>();
    // team_id → Set<club>
    const clubsByTeam = new Map<number, Set<string>>();

    for (const row of data) {
      countMap.set(`${row.team_id}-${row.club}`, (countMap.get(`${row.team_id}-${row.club}`) || 0) + 1);
      if (!clubsByTeam.has(row.team_id)) clubsByTeam.set(row.team_id, new Set());
      clubsByTeam.get(row.team_id)!.add(row.club);
      if (!clubTeamPlayers.has(row.club)) clubTeamPlayers.set(row.club, new Map());
      const m = clubTeamPlayers.get(row.club)!;
      if (!m.has(row.team_id)) m.set(row.team_id, []);
      m.get(row.team_id)!.push({ player_id: row.player_id, player_name: row.player_name });
    }

    // Totals per AFL club (across LOMAF)
    const clubTotals = new Map<string, number>();
    for (const code of ALL_CLUB_CODES) {
      let t = 0;
      for (const team of TEAMS) t += countMap.get(`${team.team_id}-${code}`) || 0;
      clubTotals.set(code, t);
    }

    // Totals per LOMAF team (for HHI + widest-net)
    const teamTotals = new Map<number, number>();
    for (const team of TEAMS) {
      let total = 0;
      for (const code of ALL_CLUB_CODES) total += countMap.get(`${team.team_id}-${code}`) || 0;
      teamTotals.set(team.team_id, total);
    }

    // HHI per AFL club: how concentrated is a club's representation in ONE LOMAF roster?
    // Sum of squared shares, where share = (count for LOMAF team) / (total for this AFL club).
    // 100% = one LOMAF team owns every player from that club. ~10% = spread evenly across 10.
    const clubConcentration = new Map<string, number>();
    for (const code of ALL_CLUB_CODES) {
      const total = clubTotals.get(code) || 0;
      if (total === 0) { clubConcentration.set(code, 0); continue; }
      let hhi = 0;
      for (const team of TEAMS) {
        const c = countMap.get(`${team.team_id}-${code}`) || 0;
        const s = c / total;
        hhi += s * s;
      }
      clubConcentration.set(code, Math.round(hhi * 1000) / 10);
    }

    // Top 5: biggest single-club bets (team × club combos with highest count)
    const biggestBets: { team_id: number; club: string; count: number }[] = [];
    for (const team of TEAMS) {
      for (const code of ALL_CLUB_CODES) {
        const c = countMap.get(`${team.team_id}-${code}`) || 0;
        if (c > 0) biggestBets.push({ team_id: team.team_id, club: code, count: c });
      }
    }
    biggestBets.sort((a, b) => b.count - a.count);

    // Top 5: widest nets (LOMAF teams by # distinct AFL clubs)
    const widestNets = TEAMS.map((t) => ({
      team_id: t.team_id,
      name: t.team_name,
      count: clubsByTeam.get(t.team_id)?.size || 0,
    })).sort((a, b) => b.count - a.count);

    // Top 5: most-drafted AFL clubs
    const mostDrafted = ALL_CLUB_CODES
      .map((code) => ({ code, count: clubTotals.get(code) || 0 }))
      .sort((a, b) => b.count - a.count);

    // Bottom 5: blind spots (fewest LOMAF players)
    const blindSpots = [...mostDrafted].sort((a, b) => a.count - b.count);

    return {
      countMap, clubTotals, teamTotals, clubConcentration,
      clubsByTeam, clubTeamPlayers,
      biggestBets, widestNets, mostDrafted, blindSpots,
    };
  }, [data]);

  const sortedClubs = useMemo(() => {
    const arr = [...ALL_CLUB_CODES];
    if (sortBy === 'alpha') return arr;
    if (sortBy === 'popularity') {
      return arr.sort((a, b) => (stats.clubTotals.get(b) || 0) - (stats.clubTotals.get(a) || 0));
    }
    // concentration: highest HHI first (one LOMAF team dominating that club)
    return arr.sort((a, b) => (stats.clubConcentration.get(b) || 0) - (stats.clubConcentration.get(a) || 0));
  }, [sortBy, stats]);

  // Max club total (for bar chart scaling)
  const maxClubTotal = useMemo(() => {
    let m = 0;
    for (const v of stats.clubTotals.values()) if (v > m) m = v;
    return m;
  }, [stats]);

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading AFL team concentration data...</div>;
  }

  if (!hasClubData) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground mb-2">No AFL club data available yet.</p>
        <p className="text-sm text-muted-foreground">Re-upload a Points Grid CSV to populate this tab.</p>
      </div>
    );
  }

  const heatColor = (count: number) => {
    if (count === 0) return 'bg-gray-50 text-transparent';
    if (count === 1) return 'bg-blue-50 text-blue-700';
    if (count === 2) return 'bg-blue-200 text-blue-900';
    if (count === 3) return 'bg-blue-400 text-white font-semibold';
    return 'bg-blue-700 text-white font-bold';
  };

  const teamById = (id: number) => TEAMS.find((t) => t.team_id === id);
  const shortTeamName = (name: string) => name.length > 14 ? name.slice(0, 13) + '…' : name;

  // Leaderboard row renderers
  const leaderRow = (
    rank: number,
    left: React.ReactNode,
    label: React.ReactNode,
    value: React.ReactNode
  ) => (
    <li className="flex items-center gap-2.5 py-1">
      <span className="text-[10px] font-bold text-muted-foreground/70 w-3 tabular-nums">{rank}</span>
      {left}
      <span className="text-xs flex-1 truncate">{label}</span>
      <span className="text-xs font-semibold tabular-nums">{value}</span>
    </li>
  );

  return (
    <div className="space-y-6">
      {/* ============ Leaderboard cards (2 cards, each with 2 Top-5 columns) ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Coach leaderboards */}
        <div className="bg-card border border-border rounded-lg shadow-sm">
          <div className="px-4 pt-3 pb-2 border-b border-border/50">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Coach leaderboards
            </h3>
          </div>
          <div className="grid grid-cols-2 divide-x divide-border/50">
            <div className="p-4">
              <p className="text-[11px] font-semibold text-foreground mb-2">Biggest single-club bets</p>
              <ol className="space-y-0.5">
                {stats.biggestBets.slice(0, 5).map((b, i) =>
                  leaderRow(
                    i + 1,
                    <ClubBadge code={b.club} size={18} />,
                    <span>
                      <span className="font-medium" style={{ color: TEAM_COLOR_MAP[b.team_id] }}>
                        {shortTeamName(teamById(b.team_id)?.team_name ?? '')}
                      </span>
                      <span className="text-muted-foreground"> × {AFL_CLUBS[b.club].name}</span>
                    </span>,
                    b.count
                  )
                )}
              </ol>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold text-foreground mb-2">Widest nets (distinct clubs)</p>
              <ol className="space-y-0.5">
                {stats.widestNets.slice(0, 5).map((w, i) =>
                  leaderRow(
                    i + 1,
                    <TeamDot teamId={w.team_id} />,
                    <span className="font-medium" style={{ color: TEAM_COLOR_MAP[w.team_id] }}>
                      {w.name}
                    </span>,
                    w.count
                  )
                )}
              </ol>
            </div>
          </div>
        </div>

        {/* Card 2: AFL club leaderboards */}
        <div className="bg-card border border-border rounded-lg shadow-sm">
          <div className="px-4 pt-3 pb-2 border-b border-border/50">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              AFL club leaderboards
            </h3>
          </div>
          <div className="grid grid-cols-2 divide-x divide-border/50">
            <div className="p-4">
              <p className="text-[11px] font-semibold text-foreground mb-2">Most-drafted</p>
              <ol className="space-y-0.5">
                {stats.mostDrafted.slice(0, 5).map((m, i) =>
                  leaderRow(
                    i + 1,
                    <ClubBadge code={m.code} size={18} />,
                    <span className="font-medium">{AFL_CLUBS[m.code].name}</span>,
                    m.count
                  )
                )}
              </ol>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold text-foreground mb-2">Blind spots</p>
              <ol className="space-y-0.5">
                {stats.blindSpots.slice(0, 5).map((m, i) =>
                  leaderRow(
                    i + 1,
                    <ClubBadge code={m.code} size={18} />,
                    <span className="font-medium">{AFL_CLUBS[m.code].name}</span>,
                    m.count
                  )
                )}
              </ol>
            </div>
          </div>
        </div>
      </div>

      {/* ============ Stacked bar chart (AFL clubs as rows) ============ */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-sm">AFL club draft spread</h3>
            <p className="text-xs text-muted-foreground">
              Each bar is one AFL club (R{latestRound}). Segments show which LOMAF rosters its players are on.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sort:</span>
            {(['alpha', 'popularity', 'concentration'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-md border transition-colors',
                  sortBy === s
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {s === 'alpha' ? 'A–Z' : s === 'popularity' ? 'Popularity' : 'Concentration'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          {sortedClubs.map((code) => {
            const total = stats.clubTotals.get(code) || 0;
            const club = AFL_CLUBS[code];
            // Build segments per LOMAF team (ordered by count desc for visual stability)
            const segments = TEAMS
              .map((t) => ({ team_id: t.team_id, team_name: t.team_name, count: stats.countMap.get(`${t.team_id}-${code}`) || 0 }))
              .filter((s) => s.count > 0)
              .sort((a, b) => b.count - a.count);
            const widthPct = maxClubTotal > 0 ? (total / maxClubTotal) * 100 : 0;
            return (
              <div key={code} className="grid grid-cols-[170px_1fr_42px] gap-3 items-center">
                <div className="flex items-center gap-2 min-w-0">
                  <ClubBadge code={code} size={22} />
                  <span className="text-xs font-medium truncate">{club.name}</span>
                </div>
                <div className="relative h-6">
                  <div
                    className="flex h-6 rounded-md overflow-hidden border border-border bg-muted/30"
                    style={{ width: `${Math.max(widthPct, 3)}%` }}
                  >
                    {segments.map((seg) => {
                      const segPct = total > 0 ? (seg.count / total) * 100 : 0;
                      return (
                        <div
                          key={seg.team_id}
                          title={`${seg.team_name}: ${seg.count} player${seg.count === 1 ? '' : 's'}`}
                          style={{
                            width: `${segPct}%`,
                            background: TEAM_COLOR_MAP[seg.team_id],
                          }}
                          className="flex items-center justify-center text-[10px] text-white font-bold min-w-0"
                        >
                          {segPct >= 15 ? seg.count : ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums text-right">
                  {total}
                </div>
              </div>
            );
          })}
        </div>

        {/* LOMAF team legend */}
        <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap gap-x-3 gap-y-1.5">
          {TEAMS.map((t) => (
            <div key={t.team_id} className="flex items-center gap-1.5">
              <TeamDot teamId={t.team_id} size={8} />
              <span className="text-[10px] text-muted-foreground">{t.team_name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ============ Heatmap (AFL clubs = rows, LOMAF teams = columns) ============ */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm">AFL Club × LOMAF Team Heatmap</h3>
          <span
            className="text-[10px] text-muted-foreground cursor-help"
            title="Club HHI = sum of squared LOMAF-team shares for that club. 100% means one LOMAF team owns every player from that club; ~10% means spread evenly across rosters."
          >
            ⓘ What&apos;s HHI?
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Rows are AFL clubs; columns are LOMAF rosters. Click a row to see player names.
        </p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="py-2 pr-2 text-left font-medium text-muted-foreground sticky left-0 bg-card z-10 min-w-[180px]">
                AFL Club
              </th>
              <th className="py-2 px-2 text-center font-medium text-muted-foreground w-12">Total</th>
              <th
                className="py-2 px-2 text-center font-medium text-muted-foreground cursor-help w-14"
                title="How concentrated this AFL club is in one LOMAF roster"
              >
                HHI
              </th>
              {TEAMS.map((team) => (
                <th key={team.team_id} className="py-2 px-1 text-center font-medium" style={{ minWidth: 46 }}>
                  <div className="flex flex-col items-center gap-1">
                    <TeamDot teamId={team.team_id} />
                    <span
                      className="text-[9px] whitespace-nowrap"
                      style={{
                        writingMode: 'vertical-rl',
                        textOrientation: 'mixed',
                        transform: 'rotate(180deg)',
                        height: 88,
                        color: TEAM_COLOR_MAP[team.team_id],
                        fontWeight: 600,
                      }}
                    >
                      {team.team_name}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedClubs.map((code) => {
              const isExpanded = expandedClub === code;
              const total = stats.clubTotals.get(code) || 0;
              const hhi = stats.clubConcentration.get(code) || 0;
              return (
                <>
                  <tr
                    key={code}
                    className={cn(
                      'border-t border-border/50 cursor-pointer hover:bg-muted/30 transition-colors',
                      isExpanded && 'bg-muted/20'
                    )}
                    onClick={() => setExpandedClub(isExpanded ? null : code)}
                  >
                    <td className="py-1.5 pr-2 sticky left-0 bg-card z-10">
                      <div className="flex items-center gap-2">
                        <ClubBadge code={code} size={22} />
                        <span className="font-medium">{AFL_CLUBS[code].name}</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-center font-semibold tabular-nums">{total}</td>
                    <td className="py-1.5 px-2 text-center font-mono text-muted-foreground tabular-nums">{hhi}%</td>
                    {TEAMS.map((team) => {
                      const count = stats.countMap.get(`${team.team_id}-${code}`) || 0;
                      return (
                        <td
                          key={team.team_id}
                          className={cn('py-1.5 px-1 text-center', heatColor(count))}
                          title={`${AFL_CLUBS[code].name} × ${team.team_name}: ${count}`}
                        >
                          {count > 0 ? count : ''}
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && (
                    <tr key={`${code}-detail`} className="bg-muted/10">
                      <td colSpan={TEAMS.length + 3} className="py-3 px-4">
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {TEAMS.map((team) => {
                            const players = stats.clubTeamPlayers.get(code)?.get(team.team_id) || [];
                            if (players.length === 0) return null;
                            return (
                              <div key={team.team_id} className="text-xs flex items-center gap-2">
                                <TeamDot teamId={team.team_id} />
                                <span className="font-semibold" style={{ color: TEAM_COLOR_MAP[team.team_id] }}>
                                  {team.team_name}
                                </span>
                                <span className="text-muted-foreground">
                                  ({players.length}): {players.map((p) => p.player_name).join(', ')}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
