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
  const [sortBy, setSortBy] = useState<'total' | 'concentration'>('concentration');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      // Find the latest round number
      const { data: roundCheck } = await supabase
        .from('player_rounds')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1);

      if (!roundCheck || roundCheck.length === 0) { setLoading(false); return; }
      const maxRound = roundCheck[0].round_number;
      setLatestRound(maxRound);

      // Fetch latest round's roster with club data
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
          if (row.club) {
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

  // Build heatmap data
  const { aflClubs, heatmap, teamTotals, maxCount, concentrationScores } = useMemo(() => {
    // Count players per (lomaf_team, afl_club)
    const countMap = new Map<string, number>();
    const clubSet = new Set<string>();
    const teamPlayerMap = new Map<number, Map<string, { player_id: number; player_name: string }[]>>();

    for (const row of data) {
      const key = `${row.team_id}-${row.club}`;
      countMap.set(key, (countMap.get(key) || 0) + 1);
      clubSet.add(row.club);

      if (!teamPlayerMap.has(row.team_id)) teamPlayerMap.set(row.team_id, new Map());
      const clubMap = teamPlayerMap.get(row.team_id)!;
      if (!clubMap.has(row.club)) clubMap.set(row.club, []);
      clubMap.get(row.club)!.push({ player_id: row.player_id, player_name: row.player_name });
    }

    // Sort AFL clubs by total usage across all LOMAF teams
    const clubTotals = new Map<string, number>();
    for (const club of clubSet) {
      let total = 0;
      for (const team of TEAMS) {
        total += countMap.get(`${team.team_id}-${club}`) || 0;
      }
      clubTotals.set(club, total);
    }
    const sorted = [...clubSet].sort((a, b) => (clubTotals.get(b) || 0) - (clubTotals.get(a) || 0));

    // Build heatmap grid
    const grid = new Map<string, { count: number; players: { player_id: number; player_name: string }[] }>();
    let max = 0;
    for (const team of TEAMS) {
      let teamTotal = 0;
      for (const club of sorted) {
        const count = countMap.get(`${team.team_id}-${club}`) || 0;
        const players = teamPlayerMap.get(team.team_id)?.get(club) || [];
        grid.set(`${team.team_id}-${club}`, { count, players });
        if (count > max) max = count;
        teamTotal += count;
      }
    }

    // Team totals
    const totals = new Map<number, number>();
    for (const team of TEAMS) {
      let t = 0;
      for (const club of sorted) t += countMap.get(`${team.team_id}-${club}`) || 0;
      totals.set(team.team_id, t);
    }

    // Concentration score (Herfindahl index) — higher = more concentrated
    const concScores = new Map<number, number>();
    for (const team of TEAMS) {
      const total = totals.get(team.team_id) || 0;
      if (total === 0) { concScores.set(team.team_id, 0); continue; }
      let hhi = 0;
      for (const club of sorted) {
        const count = countMap.get(`${team.team_id}-${club}`) || 0;
        const share = count / total;
        hhi += share * share;
      }
      concScores.set(team.team_id, Math.round(hhi * 1000) / 10);
    }

    return { aflClubs: sorted, heatmap: grid, teamTotals: totals, maxCount: max, concentrationScores: concScores };
  }, [data]);

  // Sort teams for display
  const sortedTeams = useMemo(() => {
    return [...TEAMS].sort((a, b) => {
      if (sortBy === 'concentration') {
        return (concentrationScores.get(b.team_id) || 0) - (concentrationScores.get(a.team_id) || 0);
      }
      return (teamTotals.get(b.team_id) || 0) - (teamTotals.get(a.team_id) || 0);
    });
  }, [sortBy, concentrationScores, teamTotals]);

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading AFL team concentration data...</div>;
  }

  if (!hasClubData) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground mb-2">No AFL club data available yet.</p>
        <p className="text-sm text-muted-foreground">
          Your lineups CSV needs a <code className="bg-muted px-1.5 py-0.5 rounded text-xs">club</code> or{' '}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">squad</code> column containing the AFL team
          each player belongs to (e.g., &quot;Carlton&quot;, &quot;Essendon&quot;).
          Re-upload lineups after adding this column and the heatmap will populate.
        </p>
      </div>
    );
  }

  const getHeatColor = (count: number) => {
    if (count === 0) return 'bg-gray-50';
    const intensity = count / maxCount;
    if (intensity <= 0.25) return 'bg-blue-100 text-blue-700';
    if (intensity <= 0.5) return 'bg-blue-200 text-blue-800';
    if (intensity <= 0.75) return 'bg-blue-400 text-white';
    return 'bg-blue-600 text-white font-bold';
  };

  // Find the team with highest concentration
  const mostConcentrated = sortedTeams[0];
  const mostDiverse = [...sortedTeams].sort((a, b) => (concentrationScores.get(a.team_id) || 0) - (concentrationScores.get(b.team_id) || 0))[0];

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <p className="text-xs text-muted-foreground mb-1">Most Concentrated</p>
          <p className="font-bold text-lg" style={{ color: TEAM_COLOR_MAP[mostConcentrated.team_id] }}>
            {mostConcentrated.team_name}
          </p>
          <p className="text-sm text-muted-foreground">
            HHI: {concentrationScores.get(mostConcentrated.team_id)}% — heavily invested in a few AFL clubs
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <p className="text-xs text-muted-foreground mb-1">Most Diversified</p>
          <p className="font-bold text-lg" style={{ color: TEAM_COLOR_MAP[mostDiverse.team_id] }}>
            {mostDiverse.team_name}
          </p>
          <p className="text-sm text-muted-foreground">
            HHI: {concentrationScores.get(mostDiverse.team_id)}% — spread across many AFL clubs
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <p className="text-xs text-muted-foreground mb-1">AFL Clubs Represented</p>
          <p className="font-bold text-lg">{aflClubs.length}</p>
          <p className="text-sm text-muted-foreground">
            across all LOMAF rosters (R{latestRound})
          </p>
        </div>
      </div>

      {/* Sort toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort by:</span>
        <button
          onClick={() => setSortBy('concentration')}
          className={cn(
            'text-xs px-2.5 py-1 rounded-md border transition-colors',
            sortBy === 'concentration' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'
          )}
        >
          Concentration
        </button>
        <button
          onClick={() => setSortBy('total')}
          className={cn(
            'text-xs px-2.5 py-1 rounded-md border transition-colors',
            sortBy === 'total' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'
          )}
        >
          Total Players
        </button>
      </div>

      {/* Heatmap */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm overflow-x-auto">
        <h3 className="font-semibold text-sm mb-1">AFL Club Heatmap</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Number of players from each AFL club on each LOMAF roster (as of R{latestRound}). Darker = more concentrated. Click a row to see player names.
        </p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="py-2 pr-2 text-left font-medium text-muted-foreground sticky left-0 bg-card z-10 min-w-[140px]">
                Team
              </th>
              <th className="py-2 px-1 text-center font-medium text-muted-foreground">HHI</th>
              {aflClubs.map(club => (
                <th key={club} className="py-2 px-1 text-center font-medium text-muted-foreground whitespace-nowrap" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', height: 80 }}>
                  {club}
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
                    <td className="py-1.5 px-1 text-center font-mono text-muted-foreground">
                      {concentrationScores.get(team.team_id)}%
                    </td>
                    {aflClubs.map(club => {
                      const cell = heatmap.get(`${team.team_id}-${club}`);
                      const count = cell?.count || 0;
                      return (
                        <td key={club} className={cn('py-1.5 px-1 text-center rounded-sm', getHeatColor(count))}>
                          {count > 0 ? count : ''}
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && (
                    <tr key={`${team.team_id}-detail`} className="bg-muted/10">
                      <td colSpan={aflClubs.length + 2} className="py-3 px-4">
                        <div className="flex flex-wrap gap-3">
                          {aflClubs.filter(club => (heatmap.get(`${team.team_id}-${club}`)?.count || 0) > 0).map(club => {
                            const cell = heatmap.get(`${team.team_id}-${club}`)!;
                            return (
                              <div key={club} className="text-xs">
                                <span className="font-semibold">{club}</span>
                                <span className="text-muted-foreground"> ({cell.count}): </span>
                                <span className="text-muted-foreground">{cell.players.map(p => p.player_name).join(', ')}</span>
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
