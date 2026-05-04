'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { TEAM_COLOR_MAP, TEAM_SHORT_NAMES } from '@/lib/team-colors';
import { AFL_CLUBS, ALL_CLUB_CODES } from '@/lib/afl-clubs';
import { cn } from '@/lib/utils';

// ─── Badges ─────────────────────────────────────────────────────────────────
function ClubBadge({ code, size = 24 }: { code: string; size?: number }) {
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

/**
 * Clean drill-down grid for an expanded AFL club row in the heatmap. Lists
 * every LOMAF team that owns a player from this club as its own card —
 * spaced, scannable, color-keyed by team. Teams that own none are omitted.
 */
function ExpandedClubBreakdown({
  clubName,
  clubCode,
  ownersByTeam,
  totalOwned,
}: {
  clubName: string;
  clubCode: string;
  ownersByTeam: Map<number, { player_id: number; player_name: string }[]>;
  totalOwned: number;
}) {
  const owners = TEAMS
    .map((team) => ({
      team,
      players: ownersByTeam.get(team.team_id) ?? [],
    }))
    .filter((o) => o.players.length > 0)
    // Most owned first
    .sort((a, b) => b.players.length - a.players.length);

  return (
    <div className="px-5 py-5 bg-muted/10 border-t border-border">
      {/* Header summarizing the breakdown */}
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <ClubBadge code={clubCode} size={16} /> <span className="ml-1.5">{clubName}</span>{' '}
          <span className="text-muted-foreground/70 font-normal normal-case tracking-normal">
            — owned by {owners.length} of {TEAMS.length} LOMAF team{owners.length === 1 ? '' : 's'} ({totalOwned} player{totalOwned === 1 ? '' : 's'} total)
          </span>
        </p>
      </div>

      {owners.length === 0 ? (
        <p className="text-xs italic text-muted-foreground py-2">
          No LOMAF team currently owns a player from {clubName}.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {owners.map(({ team, players }) => {
            const teamColor = TEAM_COLOR_MAP[team.team_id] ?? '#6B7280';
            return (
              <div
                key={team.team_id}
                className="bg-card border border-border rounded-lg p-3 hover:shadow-sm transition-shadow"
                style={{ borderLeft: `3px solid ${teamColor}` }}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold truncate" style={{ color: teamColor }}>
                    {TEAM_SHORT_NAMES[team.team_id]}
                  </span>
                  <span
                    className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full"
                    style={{
                      background: `${teamColor}1A`,
                      color: teamColor,
                    }}
                  >
                    × {players.length}
                  </span>
                </div>
                <ul className="space-y-1">
                  {players.map((p) => (
                    <li key={p.player_id} className="text-xs text-foreground leading-snug truncate">
                      {p.player_name}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
  const [hover, setHover] = useState<{ row?: string; col?: number }>({});

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
    const countMap = new Map<string, number>();
    const clubTeamPlayers = new Map<string, Map<number, { player_id: number; player_name: string }[]>>();
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

    const clubTotals = new Map<string, number>();
    for (const code of ALL_CLUB_CODES) {
      let t = 0;
      for (const team of TEAMS) t += countMap.get(`${team.team_id}-${code}`) || 0;
      clubTotals.set(code, t);
    }

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

    // Top 5 biggest bets
    const biggestBets: { team_id: number; club: string; count: number }[] = [];
    for (const team of TEAMS) {
      for (const code of ALL_CLUB_CODES) {
        const c = countMap.get(`${team.team_id}-${code}`) || 0;
        if (c > 0) biggestBets.push({ team_id: team.team_id, club: code, count: c });
      }
    }
    biggestBets.sort((a, b) => b.count - a.count);

    const widestNets = TEAMS.map((t) => ({
      team_id: t.team_id, name: t.team_name,
      count: clubsByTeam.get(t.team_id)?.size || 0,
    })).sort((a, b) => b.count - a.count);

    const mostDrafted = ALL_CLUB_CODES
      .map((code) => ({ code, count: clubTotals.get(code) || 0 }))
      .sort((a, b) => b.count - a.count);

    const blindSpots = [...mostDrafted].sort((a, b) => a.count - b.count);

    return { countMap, clubTotals, clubConcentration, clubsByTeam, clubTeamPlayers,
             biggestBets, widestNets, mostDrafted, blindSpots };
  }, [data]);

  const sortedClubs = useMemo(() => {
    const arr = [...ALL_CLUB_CODES];
    if (sortBy === 'alpha') return arr;
    if (sortBy === 'popularity') return arr.sort((a, b) => (stats.clubTotals.get(b) || 0) - (stats.clubTotals.get(a) || 0));
    return arr.sort((a, b) => (stats.clubConcentration.get(b) || 0) - (stats.clubConcentration.get(a) || 0));
  }, [sortBy, stats]);

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

  // Heat scale — makes 3+ pop in orange, 5+ in red
  const heatStyle = (count: number): { bg: string; color: string; fontWeight: number } => {
    if (count === 0)  return { bg: 'rgba(0,0,0,0.015)',        color: 'transparent',   fontWeight: 400 };
    if (count === 1)  return { bg: 'rgba(59,130,246,0.15)',    color: '#1E40AF',       fontWeight: 500 };
    if (count === 2)  return { bg: 'rgba(59,130,246,0.38)',    color: '#1E3A8A',       fontWeight: 600 };
    if (count === 3)  return { bg: 'rgba(59,130,246,0.78)',    color: '#FFFFFF',       fontWeight: 700 };
    if (count === 4)  return { bg: '#FF7B3A',                  color: '#FFFFFF',       fontWeight: 800 };
    return              { bg: '#FF4757',                       color: '#FFFFFF',       fontWeight: 800 };
  };

  // Leaderboard row: rank | icon | (two-line name) | value. Clickable when
  // onClick is provided — drives the click-to-drill-down to the heatmap.
  const LeaderRow = ({
    rank, icon, line1, line2, value, onClick,
  }: {
    rank: number;
    icon: React.ReactNode;
    line1: React.ReactNode;
    line2?: React.ReactNode;
    value: React.ReactNode;
    onClick?: () => void;
  }) => {
    const inner = (
      <>
        <span className="text-[11px] font-bold text-muted-foreground/60 w-3 tabular-nums">{rank}</span>
        {icon}
        <div className="flex-1 min-w-0 text-left">
          <div className="text-xs font-semibold truncate">{line1}</div>
          {line2 && <div className="text-[10px] text-muted-foreground truncate">{line2}</div>}
        </div>
        <span className="text-sm font-bold tabular-nums">{value}</span>
      </>
    );
    if (onClick) {
      return (
        <li>
          <button
            onClick={onClick}
            className="w-full flex items-center gap-3 py-1.5 px-1 -mx-1 rounded hover:bg-muted/40 transition-colors"
          >
            {inner}
          </button>
        </li>
      );
    }
    return <li className="flex items-center gap-3 py-1.5">{inner}</li>;
  };

  // Click on any leaderboard item → expand the corresponding row in the heatmap
  // and scroll to it. Means the existing per-team breakdown UI doubles as the
  // drill-down for the leaderboards.
  const focusClub = (code: string) => {
    setExpandedClub((prev) => (prev === code ? null : code));
    requestAnimationFrame(() => {
      const el = document.getElementById(`afl-row-${code}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  return (
    <div className="space-y-6">
      {/* Header — what this tab actually shows */}
      <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
        <h2 className="text-sm font-semibold mb-1">AFL Club Concentration</h2>
        <p className="text-xs text-muted-foreground">
          Which AFL clubs are most represented across LOMAF rosters{' '}
          <span className="font-semibold text-foreground">right now</span> (R{latestRound}).
          Reflects current rosters — trades, waivers, and pickups are all included.
        </p>
      </div>

      {/* ============ Leaderboard cards ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Coach leaderboards */}
        <div className="bg-card border border-border rounded-lg shadow-sm">
          <div className="px-4 pt-3 pb-2 border-b border-border/50">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              LOMAF Coach Leaderboards
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50">
            <div className="p-4">
              <p className="text-[11px] font-semibold text-foreground mb-1">Biggest single-club bets</p>
              <p className="text-[10px] text-muted-foreground mb-2">
                One LOMAF coach with the most players from a single AFL club.
              </p>
              <ol className="space-y-0">
                {stats.biggestBets.slice(0, 5).map((b, i) => (
                  <LeaderRow
                    key={`bb-${i}`}
                    rank={i + 1}
                    icon={<ClubBadge code={b.club} size={22} />}
                    line1={
                      <span style={{ color: TEAM_COLOR_MAP[b.team_id] }}>
                        {TEAM_SHORT_NAMES[b.team_id]}
                      </span>
                    }
                    line2={<>× {AFL_CLUBS[b.club].name}</>}
                    value={b.count}
                    onClick={() => focusClub(b.club)}
                  />
                ))}
              </ol>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold text-foreground mb-1">Widest nets</p>
              <p className="text-[10px] text-muted-foreground mb-2">
                LOMAF coaches whose rosters span the most different AFL clubs.
              </p>
              <ol className="space-y-0">
                {stats.widestNets.slice(0, 5).map((w, i) => (
                  <LeaderRow
                    key={`wn-${i}`}
                    rank={i + 1}
                    icon={<TeamDot teamId={w.team_id} size={14} />}
                    line1={
                      <span style={{ color: TEAM_COLOR_MAP[w.team_id] }}>
                        {TEAM_SHORT_NAMES[w.team_id]}
                      </span>
                    }
                    line2={<>{w.name}</>}
                    value={<>{w.count} <span className="text-[10px] text-muted-foreground font-normal">clubs</span></>}
                  />
                ))}
              </ol>
            </div>
          </div>
        </div>

        {/* AFL club leaderboards */}
        <div className="bg-card border border-border rounded-lg shadow-sm">
          <div className="px-4 pt-3 pb-2 border-b border-border/50">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              AFL Club Ownership
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50">
            <div className="p-4">
              <p className="text-[11px] font-semibold text-foreground mb-1">Most-owned AFL clubs</p>
              <p className="text-[10px] text-muted-foreground mb-2">
                AFL clubs with the most players across LOMAF rosters right now.
                Click to see who owns them.
              </p>
              <ol className="space-y-0">
                {stats.mostDrafted.slice(0, 5).map((m, i) => (
                  <LeaderRow
                    key={`md-${i}`}
                    rank={i + 1}
                    icon={<ClubBadge code={m.code} size={22} />}
                    line1={AFL_CLUBS[m.code].name}
                    value={m.count}
                    onClick={() => focusClub(m.code)}
                  />
                ))}
              </ol>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold text-foreground mb-1">Least-owned AFL clubs</p>
              <p className="text-[10px] text-muted-foreground mb-2">
                AFL clubs barely represented across LOMAF rosters. The league&apos;s blind spots.
              </p>
              <ol className="space-y-0">
                {stats.blindSpots.slice(0, 5).map((m, i) => (
                  <LeaderRow
                    key={`bs-${i}`}
                    rank={i + 1}
                    icon={<ClubBadge code={m.code} size={22} />}
                    line1={AFL_CLUBS[m.code].name}
                    value={m.count}
                    onClick={() => focusClub(m.code)}
                  />
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>

      {/* ============ Focused bar chart: labeled top contenders + others ============ */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-sm">AFL Club Ownership Across LOMAF Rosters</h3>
            <p className="text-xs text-muted-foreground">
              Current rosters (R{latestRound}). Each bar is one AFL club; the segments show which LOMAF teams own them. Top 3 owners labelled, the rest fold into <span className="text-foreground">others</span>.
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
                {s === 'alpha' ? 'A–Z' : s === 'popularity' ? 'Total' : 'Concentration'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {sortedClubs.map((code) => {
            const total = stats.clubTotals.get(code) || 0;
            const club = AFL_CLUBS[code];
            const allSegments = TEAMS
              .map((t) => ({ team_id: t.team_id, count: stats.countMap.get(`${t.team_id}-${code}`) || 0 }))
              .filter((s) => s.count > 0)
              .sort((a, b) => b.count - a.count);
            // Highlight top 3 with count >= 2, rest fold into 'others'
            const highlighted = allSegments.filter((s) => s.count >= 2).slice(0, 3);
            const highlightedIds = new Set(highlighted.map((s) => s.team_id));
            const othersTotal = allSegments.filter((s) => !highlightedIds.has(s.team_id)).reduce((a, b) => a + b.count, 0);
            const barWidth = maxClubTotal > 0 ? (total / maxClubTotal) * 100 : 0;

            return (
              <div key={code} className="grid grid-cols-[200px_40px_1fr] gap-3 items-start">
                <div className="flex items-center gap-2 min-w-0 pt-0.5">
                  <ClubBadge code={code} size={24} />
                  <span className="text-sm font-medium truncate">{club.name}</span>
                </div>
                <div className="text-sm font-bold tabular-nums text-right pt-0.5">{total}</div>
                <div>
                  <div
                    className="flex h-5 rounded-md overflow-hidden border border-border/60"
                    style={{ width: `${Math.max(barWidth, 3)}%`, minWidth: 40 }}
                  >
                    {highlighted.map((seg) => {
                      const pct = total > 0 ? (seg.count / total) * 100 : 0;
                      return (
                        <div
                          key={seg.team_id}
                          style={{ width: `${pct}%`, background: TEAM_COLOR_MAP[seg.team_id] }}
                          title={`${TEAM_SHORT_NAMES[seg.team_id]}: ${seg.count}`}
                        />
                      );
                    })}
                    {othersTotal > 0 && (
                      <div
                        style={{ width: `${total > 0 ? (othersTotal / total) * 100 : 0}%`, background: '#D1D5DB' }}
                        title={`others: ${othersTotal}`}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {highlighted.map((seg) => (
                      <span
                        key={seg.team_id}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background: `${TEAM_COLOR_MAP[seg.team_id]}22`,
                          color: TEAM_COLOR_MAP[seg.team_id],
                          border: `1px solid ${TEAM_COLOR_MAP[seg.team_id]}44`,
                        }}
                      >
                        {TEAM_SHORT_NAMES[seg.team_id]} ×{seg.count}
                      </span>
                    ))}
                    {othersTotal > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                        others ×{othersTotal}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ============ Heatmap ============ */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm">AFL Club × LOMAF Team Heatmap</h3>
          <span
            className="text-[10px] text-muted-foreground cursor-help"
            title="Club HHI = sum of squared LOMAF-team shares for that club. 100% = one LOMAF team owns every player from that club; ~10% = spread evenly across all rosters."
          >
            ⓘ What&apos;s HHI?
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Rows are AFL clubs; columns are LOMAF rosters.
          Cells: <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle" style={{ background: 'rgba(59,130,246,0.38)' }} /> blue = 1–2
          <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle ml-2 mr-0.5" style={{ background: 'rgba(59,130,246,0.78)' }} /> dark blue = 3
          <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle ml-2 mr-0.5" style={{ background: '#FF7B3A' }} /> orange = 4
          <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle ml-2 mr-0.5" style={{ background: '#FF4757' }} /> red = 5+.
          Click any row or cell to see player names.
        </p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="py-3 pr-4 text-left font-medium text-muted-foreground sticky left-0 bg-card z-10 min-w-[200px]">
                AFL Club
              </th>
              <th className="py-3 px-3 text-center font-medium text-muted-foreground w-16">Total</th>
              <th
                className="py-3 px-3 text-center font-medium text-muted-foreground cursor-help w-16"
                title="How concentrated this AFL club is in one LOMAF roster"
              >
                HHI
              </th>
              {TEAMS.map((team, colIdx) => {
                const isColHot = hover.col === colIdx;
                return (
                  <th
                    key={team.team_id}
                    className={cn(
                      'py-3 px-2 text-center font-medium transition-colors',
                      isColHot && 'bg-muted/40'
                    )}
                    style={{ minWidth: 80 }}
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <TeamDot teamId={team.team_id} size={11} />
                      <span
                        className="text-[10px] whitespace-nowrap font-semibold"
                        style={{ color: TEAM_COLOR_MAP[team.team_id] }}
                      >
                        {TEAM_SHORT_NAMES[team.team_id]}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedClubs.map((code) => {
              const isExpanded = expandedClub === code;
              const isRowHot = hover.row === code;
              const total = stats.clubTotals.get(code) || 0;
              const hhi = stats.clubConcentration.get(code) || 0;
              return (
                <>
                  <tr
                    key={code}
                    id={`afl-row-${code}`}
                    className={cn(
                      'border-t border-border/50 cursor-pointer transition-colors',
                      isRowHot ? 'bg-muted/40' : 'hover:bg-muted/20',
                      isExpanded && 'bg-muted/20 ring-1 ring-primary/40'
                    )}
                    onClick={() => setExpandedClub(isExpanded ? null : code)}
                  >
                    <td className={cn('py-3 pr-4 sticky left-0 z-10', isRowHot ? 'bg-muted/40' : 'bg-card')}>
                      <div className="flex items-center gap-2.5">
                        <ClubBadge code={code} size={26} />
                        <span className="font-medium text-sm">{AFL_CLUBS[code].name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center font-semibold text-sm tabular-nums">{total}</td>
                    <td className="py-3 px-3 text-center font-mono text-muted-foreground tabular-nums">{hhi}%</td>
                    {TEAMS.map((team, colIdx) => {
                      const count = stats.countMap.get(`${team.team_id}-${code}`) || 0;
                      const s = heatStyle(count);
                      const isColHot = hover.col === colIdx;
                      return (
                        <td
                          key={team.team_id}
                          onMouseEnter={() => setHover({ row: code, col: colIdx })}
                          onMouseLeave={() => setHover({})}
                          onClick={(e) => {
                            // Cell click also expands — same drill-down. Stop the
                            // event so the row click handler doesn't fire twice.
                            e.stopPropagation();
                            setExpandedClub(isExpanded ? null : code);
                          }}
                          className="px-1 py-1 transition-colors cursor-pointer"
                          style={{
                            outline: (isRowHot || isColHot) ? '1px solid rgba(0,0,0,0.08)' : 'none',
                          }}
                          title={`${AFL_CLUBS[code].name} × ${team.team_name}: ${count}`}
                        >
                          <div
                            className="text-center rounded-md flex items-center justify-center transition-transform hover:scale-[1.05]"
                            style={{
                              background: s.bg,
                              color: s.color,
                              fontWeight: s.fontWeight,
                              height: 36,
                              fontSize: 13,
                            }}
                          >
                            {count > 0 ? count : ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && (
                    <tr key={`${code}-detail`} className="bg-muted/10">
                      <td colSpan={TEAMS.length + 3} className="p-0">
                        <ExpandedClubBreakdown
                          clubName={AFL_CLUBS[code].name}
                          clubCode={code}
                          ownersByTeam={stats.clubTeamPlayers.get(code) ?? new Map()}
                          totalOwned={total}
                        />
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
