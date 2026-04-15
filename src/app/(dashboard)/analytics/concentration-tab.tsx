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

// AFL clubs — full names, primary brand colors, contrast text for badges.
// Sorted alphabetically by `name` in the UI (matches afl.com.au).
interface AflClub { name: string; primary: string; text: string }
const AFL_CLUBS: Record<string, AflClub> = {
  ADE: { name: 'Adelaide Crows',         primary: '#002B5C', text: '#E21937' },
  BRL: { name: 'Brisbane Lions',         primary: '#A30046', text: '#FFCD00' },
  CAR: { name: 'Carlton',                primary: '#031A29', text: '#FFFFFF' },
  COL: { name: 'Collingwood',            primary: '#000000', text: '#FFFFFF' },
  ESS: { name: 'Essendon',               primary: '#CC2031', text: '#000000' },
  FRE: { name: 'Fremantle',              primary: '#2A0D54', text: '#FFFFFF' },
  GEE: { name: 'Geelong Cats',           primary: '#002B5C', text: '#FFFFFF' },
  GCS: { name: 'Gold Coast Suns',        primary: '#D71920', text: '#F8C20A' },
  GWS: { name: 'GWS Giants',             primary: '#F47B20', text: '#000000' },
  HAW: { name: 'Hawthorn',               primary: '#4D2004', text: '#FFC423' },
  MEL: { name: 'Melbourne',              primary: '#0F1131', text: '#CC2031' },
  NTH: { name: 'North Melbourne',        primary: '#013B9F', text: '#FFFFFF' },
  PTA: { name: 'Port Adelaide',          primary: '#01B2A9', text: '#000000' },
  RIC: { name: 'Richmond',               primary: '#000000', text: '#FFD200' },
  STK: { name: 'St Kilda',               primary: '#000000', text: '#ED1B2F' },
  SYD: { name: 'Sydney Swans',           primary: '#ED171F', text: '#FFFFFF' },
  WCE: { name: 'West Coast Eagles',      primary: '#003087', text: '#F2A900' },
  WBD: { name: 'Western Bulldogs',       primary: '#014896', text: '#CC2031' },
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
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.38),
        fontWeight: 800,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: '-0.02em',
        flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)',
      }}
    >
      {code}
    </span>
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
  const [expandedTeam, setExpandedTeam] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'alpha' | 'concentration' | 'spread'>('alpha');

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
    // Count players per (lomaf_team, afl_club)
    const countMap = new Map<string, number>();
    const clubsByTeam = new Map<number, Set<string>>();
    const teamPlayerMap = new Map<number, Map<string, { player_id: number; player_name: string }[]>>();

    for (const row of data) {
      const key = `${row.team_id}-${row.club}`;
      countMap.set(key, (countMap.get(key) || 0) + 1);
      if (!clubsByTeam.has(row.team_id)) clubsByTeam.set(row.team_id, new Set());
      clubsByTeam.get(row.team_id)!.add(row.club);
      if (!teamPlayerMap.has(row.team_id)) teamPlayerMap.set(row.team_id, new Map());
      const cm = teamPlayerMap.get(row.team_id)!;
      if (!cm.has(row.club)) cm.set(row.club, []);
      cm.get(row.club)!.push({ player_id: row.player_id, player_name: row.player_name });
    }

    // Per-team totals and HHI
    const teamTotals = new Map<number, number>();
    const concentrationScores = new Map<number, number>();
    for (const team of TEAMS) {
      let total = 0;
      for (const code of ALL_CLUB_CODES) total += countMap.get(`${team.team_id}-${code}`) || 0;
      teamTotals.set(team.team_id, total);
      if (total === 0) { concentrationScores.set(team.team_id, 0); continue; }
      let hhi = 0;
      for (const code of ALL_CLUB_CODES) {
        const c = countMap.get(`${team.team_id}-${code}`) || 0;
        const s = c / total;
        hhi += s * s;
      }
      concentrationScores.set(team.team_id, Math.round(hhi * 1000) / 10);
    }

    // AFL club → total LOMAF players
    const clubTotals = new Map<string, number>();
    for (const code of ALL_CLUB_CODES) {
      let t = 0;
      for (const team of TEAMS) t += countMap.get(`${team.team_id}-${code}`) || 0;
      clubTotals.set(code, t);
    }

    // Biggest single-club bet: highest count for any (team, club) cell
    let biggestBet: { team_id: number; club: string; count: number } | null = null;
    for (const team of TEAMS) {
      for (const code of ALL_CLUB_CODES) {
        const c = countMap.get(`${team.team_id}-${code}`) || 0;
        if (!biggestBet || c > biggestBet.count) biggestBet = { team_id: team.team_id, club: code, count: c };
      }
    }

    // Widest net: most distinct AFL clubs in a LOMAF roster
    let widestNet: { team_id: number; count: number } | null = null;
    let narrowestNet: { team_id: number; count: number } | null = null;
    for (const team of TEAMS) {
      const n = clubsByTeam.get(team.team_id)?.size || 0;
      if (!widestNet || n > widestNet.count) widestNet = { team_id: team.team_id, count: n };
      if (!narrowestNet || (n > 0 && n < narrowestNet.count)) narrowestNet = { team_id: team.team_id, count: n };
    }

    // Most popular / least represented AFL club
    let mostPopularClub: { code: string; count: number } | null = null;
    let rarestClub: { code: string; count: number } | null = null;
    for (const code of ALL_CLUB_CODES) {
      const c = clubTotals.get(code) || 0;
      if (!mostPopularClub || c > mostPopularClub.count) mostPopularClub = { code, count: c };
      if (!rarestClub || c < rarestClub.count) rarestClub = { code, count: c };
    }

    const maxCount = biggestBet?.count ?? 0;

    return {
      countMap, teamTotals, concentrationScores, clubTotals, clubsByTeam,
      teamPlayerMap, biggestBet, widestNet, narrowestNet,
      mostPopularClub, rarestClub, maxCount,
    };
  }, [data]);

  const sortedTeams = useMemo(() => {
    const arr = [...TEAMS];
    if (sortBy === 'alpha') return arr.sort((a, b) => a.team_name.localeCompare(b.team_name));
    if (sortBy === 'concentration') {
      return arr.sort((a, b) => (stats.concentrationScores.get(b.team_id) || 0) - (stats.concentrationScores.get(a.team_id) || 0));
    }
    // spread: highest # distinct AFL clubs first
    return arr.sort((a, b) => (stats.clubsByTeam.get(b.team_id)?.size || 0) - (stats.clubsByTeam.get(a.team_id)?.size || 0));
  }, [sortBy, stats]);

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading AFL team concentration data...</div>;
  }

  if (!hasClubData) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground mb-2">No AFL club data available yet.</p>
        <p className="text-sm text-muted-foreground">
          Re-upload a Points Grid CSV to populate this tab.
        </p>
      </div>
    );
  }

  const getHeatColor = (count: number) => {
    if (count === 0) return 'bg-gray-50 text-transparent';
    if (count === 1) return 'bg-blue-50 text-blue-700';
    if (count === 2) return 'bg-blue-200 text-blue-900';
    if (count === 3) return 'bg-blue-400 text-white font-semibold';
    return 'bg-blue-700 text-white font-bold';
  };

  const teamById = (id: number) => TEAMS.find((t) => t.team_id === id);

  return (
    <div className="space-y-6">
      {/* ============ Insight cards ============ */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Biggest single-club bet */}
        {stats.biggestBet && (
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground mb-2">Biggest single-club bet</p>
            <div className="flex items-center gap-2 mb-1">
              <ClubBadge code={stats.biggestBet.club} size={30} />
              <span className="text-2xl font-bold tabular-nums">{stats.biggestBet.count}</span>
              <span className="text-sm text-muted-foreground">players</span>
            </div>
            <p className="text-sm font-semibold" style={{ color: TEAM_COLOR_MAP[stats.biggestBet.team_id] }}>
              {teamById(stats.biggestBet.team_id)?.team_name}
            </p>
            <p className="text-xs text-muted-foreground">from {AFL_CLUBS[stats.biggestBet.club]?.name}</p>
          </div>
        )}

        {/* Widest net */}
        {stats.widestNet && (
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground mb-2">Widest net</p>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-2xl font-bold tabular-nums">{stats.widestNet.count}</span>
              <span className="text-sm text-muted-foreground">AFL clubs</span>
            </div>
            <p className="text-sm font-semibold" style={{ color: TEAM_COLOR_MAP[stats.widestNet.team_id] }}>
              {teamById(stats.widestNet.team_id)?.team_name}
            </p>
            <p className="text-xs text-muted-foreground">spread across the most clubs</p>
          </div>
        )}

        {/* Most popular AFL club in LOMAF */}
        {stats.mostPopularClub && (
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground mb-2">Most-drafted AFL club</p>
            <div className="flex items-center gap-2 mb-1">
              <ClubBadge code={stats.mostPopularClub.code} size={30} />
              <span className="text-2xl font-bold tabular-nums">{stats.mostPopularClub.count}</span>
              <span className="text-sm text-muted-foreground">players</span>
            </div>
            <p className="text-sm font-semibold">{AFL_CLUBS[stats.mostPopularClub.code]?.name}</p>
            <p className="text-xs text-muted-foreground">across all LOMAF rosters</p>
          </div>
        )}

        {/* Rarest AFL club in LOMAF */}
        {stats.rarestClub && (
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground mb-2">Biggest blind spot</p>
            <div className="flex items-center gap-2 mb-1">
              <ClubBadge code={stats.rarestClub.code} size={30} />
              <span className="text-2xl font-bold tabular-nums">{stats.rarestClub.count}</span>
              <span className="text-sm text-muted-foreground">players</span>
            </div>
            <p className="text-sm font-semibold">{AFL_CLUBS[stats.rarestClub.code]?.name}</p>
            <p className="text-xs text-muted-foreground">least-represented across LOMAF</p>
          </div>
        )}
      </div>

      {/* ============ Stacked bar chart ============ */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm">Roster AFL-club mix</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sort:</span>
            {(['alpha', 'concentration', 'spread'] as const).map((s) => (
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
                {s === 'alpha' ? 'A–Z' : s === 'concentration' ? 'Concentration' : 'Spread'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Each bar is one LOMAF roster (R{latestRound}). Segments are AFL clubs coloured by their brand. Hover for counts.
        </p>
        <div className="space-y-2.5">
          {sortedTeams.map((team) => {
            const total = stats.teamTotals.get(team.team_id) || 0;
            if (total === 0) return null;
            // Build segments in alphabetical AFL-club order for stable stacking
            const segments = ALL_CLUB_CODES
              .map((code) => ({ code, count: stats.countMap.get(`${team.team_id}-${code}`) || 0 }))
              .filter((s) => s.count > 0);
            const distinct = stats.clubsByTeam.get(team.team_id)?.size || 0;
            return (
              <div key={team.team_id} className="grid grid-cols-[180px_1fr_70px] gap-3 items-center">
                <div className="text-xs font-medium truncate" style={{ color: TEAM_COLOR_MAP[team.team_id] }}>
                  {team.team_name}
                </div>
                <div className="flex h-6 rounded-md overflow-hidden border border-border">
                  {segments.map((seg) => {
                    const club = AFL_CLUBS[seg.code];
                    const widthPct = (seg.count / total) * 100;
                    return (
                      <div
                        key={seg.code}
                        title={`${club.name}: ${seg.count} player${seg.count === 1 ? '' : 's'}`}
                        style={{
                          width: `${widthPct}%`,
                          background: club.primary,
                          color: club.text,
                        }}
                        className="flex items-center justify-center text-[10px] font-bold min-w-0"
                      >
                        {widthPct >= 8 ? seg.count : ''}
                      </div>
                    );
                  })}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {distinct} <span className="opacity-60">clubs</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ============ Heatmap ============ */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm">AFL Club Heatmap</h3>
          <span
            className="text-[10px] text-muted-foreground cursor-help"
            title="HHI (Herfindahl–Hirschman Index): sum of squared roster shares per AFL club. ~6% = evenly spread across all 18 clubs; 20%+ = heavily concentrated in a few."
          >
            ⓘ What&apos;s HHI?
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Players from each AFL club (columns, A–Z) on each LOMAF roster (rows). Click a row to see player names.
        </p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="py-2 pr-2 text-left font-medium text-muted-foreground sticky left-0 bg-card z-10 min-w-[160px]">
                Team
              </th>
              <th
                className="py-2 px-1 text-center font-medium text-muted-foreground cursor-help"
                title="Herfindahl Index — higher = more concentrated in a few AFL clubs"
              >
                HHI
              </th>
              {ALL_CLUB_CODES.map((code) => (
                <th key={code} className="py-2 px-1 text-center font-medium" style={{ minWidth: 42 }}>
                  <div className="flex flex-col items-center gap-1">
                    <ClubBadge code={code} size={26} />
                    <span
                      className="text-[9px] text-muted-foreground whitespace-nowrap"
                      style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)', height: 70 }}
                    >
                      {AFL_CLUBS[code].name}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((team) => {
              const isExpanded = expandedTeam === team.team_id;
              return (
                <>
                  <tr
                    key={team.team_id}
                    className={cn(
                      'border-t border-border/50 cursor-pointer hover:bg-muted/30 transition-colors',
                      isExpanded && 'bg-muted/20'
                    )}
                    onClick={() => setExpandedTeam(isExpanded ? null : team.team_id)}
                  >
                    <td className="py-1.5 pr-2 sticky left-0 bg-card z-10">
                      <span className="font-medium" style={{ color: TEAM_COLOR_MAP[team.team_id] }}>
                        {team.team_name}
                      </span>
                    </td>
                    <td className="py-1.5 px-1 text-center font-mono text-muted-foreground tabular-nums">
                      {stats.concentrationScores.get(team.team_id)}%
                    </td>
                    {ALL_CLUB_CODES.map((code) => {
                      const count = stats.countMap.get(`${team.team_id}-${code}`) || 0;
                      return (
                        <td
                          key={code}
                          className={cn('py-1.5 px-1 text-center', getHeatColor(count))}
                          title={`${team.team_name} × ${AFL_CLUBS[code].name}: ${count}`}
                        >
                          {count > 0 ? count : ''}
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && (
                    <tr key={`${team.team_id}-detail`} className="bg-muted/10">
                      <td colSpan={ALL_CLUB_CODES.length + 2} className="py-3 px-4">
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {ALL_CLUB_CODES
                            .filter((code) => (stats.countMap.get(`${team.team_id}-${code}`) || 0) > 0)
                            .map((code) => {
                              const players = stats.teamPlayerMap.get(team.team_id)?.get(code) || [];
                              return (
                                <div key={code} className="text-xs flex items-center gap-2">
                                  <ClubBadge code={code} size={20} />
                                  <span className="font-semibold">{AFL_CLUBS[code].name}</span>
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
