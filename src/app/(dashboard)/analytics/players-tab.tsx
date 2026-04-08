'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';

interface PlayerStat {
  player_id: number;
  player_name: string;
  team_name: string;
  team_id: number;
  position: string;
  avg_score: number;
  total_score: number;
  high_score: number;
  low_score: number;
  rounds_played: number;
  latest_score: number | null;
  roundScores: Record<number, number | null>;
  isBestInPos: boolean;
}

type SortKey = 'avg_score' | 'total_score' | 'high_score' | 'low_score' | 'rounds_played' | 'player_name' | 'latest_score';

// Score color: green 100+, yellow 70-99, red <70
function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 100) return 'text-green-600 font-semibold';
  if (score >= 70) return 'text-yellow-600';
  return 'text-red-600';
}

function avgBadge(avg: number): string {
  if (avg >= 100) return 'bg-green-100 text-green-700';
  if (avg >= 70) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

export default function PlayersTab() {
  const [players, setPlayers] = useState<PlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('avg_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [filterTeam, setFilterTeam] = useState<number | null>(null);
  const [filterPos, setFilterPos] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [validRounds, setValidRounds] = useState<number[]>([]);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadPlayers(); }, []);

  const loadPlayers = async () => {
    try {
      // Fetch draft picks to get real player positions
      const { data: draftPicks } = await supabase
        .from('draft_picks')
        .select('player_id, position');

      // Build position lookup from draft CSV (deduplicated)
      const draftPositionMap: Record<number, string> = {};
      draftPicks?.forEach(dp => {
        if (dp.position && !draftPositionMap[dp.player_id]) {
          draftPositionMap[dp.player_id] = dp.position;
        }
      });

      // Fetch all player_rounds (paginated)
      const allRows: { player_id: number; player_name: string; team_id: number; team_name: string; pos: string; points: number | null; is_scoring: boolean; round_number: number }[] = [];
      let offset = 0;
      while (true) {
        const { data } = await supabase
          .from('player_rounds')
          .select('player_id, player_name, team_id, team_name, pos, points, is_scoring, round_number')
          .range(offset, offset + 999);
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
      }

      if (allRows.length === 0) { setLoading(false); return; }

      // Valid rounds
      const rounds = [...new Set(allRows.map(r => r.round_number))].sort((a, b) => a - b);
      const valid = rounds.filter(round => {
        const teamsWithScores = new Set(
          allRows.filter(r => r.round_number === round && r.is_scoring && r.points != null && Number(r.points) > 0).map(r => r.team_id)
        );
        return teamsWithScores.size >= 8;
      });
      setValidRounds(valid);

      // Aggregate stats per player
      const playerMap: Record<string, {
        player_id: number; player_name: string; team_name: string; team_id: number;
        position: string; scores: number[]; roundScores: Record<number, number | null>;
      }> = {};

      // Track most common lineup slot per player (fallback for waiver players)
      const playerSlotCounts: Record<string, Record<string, number>> = {};

      allRows.forEach(pr => {
        if (!valid.includes(pr.round_number)) return;
        const key = `${pr.player_id}-${pr.team_id}`;
        if (!playerMap[key]) {
          playerMap[key] = {
            player_id: pr.player_id, player_name: pr.player_name,
            team_name: pr.team_name, team_id: pr.team_id,
            position: '', scores: [], roundScores: {},
          };
        }
        // Track lineup slot frequency (exclude UTL and BN for fallback position)
        if (pr.pos !== 'UTL' && pr.pos !== 'BN' && pr.is_scoring) {
          if (!playerSlotCounts[key]) playerSlotCounts[key] = {};
          playerSlotCounts[key][pr.pos] = (playerSlotCounts[key][pr.pos] || 0) + 1;
        }
        if (pr.points != null && Number(pr.points) > 0) {
          playerMap[key].scores.push(Number(pr.points));
          playerMap[key].roundScores[pr.round_number] = Number(pr.points);
        }
      });

      // Assign real positions from draft CSV, with lineup slot fallback
      Object.entries(playerMap).forEach(([key, p]) => {
        const draftPos = draftPositionMap[p.player_id];
        if (draftPos) {
          p.position = draftPos;
        } else {
          // Fallback: most common lineup slot (excluding UTL/BN)
          const slots = playerSlotCounts[key] || {};
          const sorted = Object.entries(slots).sort((a, b) => b[1] - a[1]);
          p.position = sorted.length > 0 ? sorted[0][0] : 'MID';
        }
      });

      // Find best in each real position (DEF, MID, FWD, RUC — expand dual positions)
      const bestByPos: Record<string, number> = {};
      Object.values(playerMap).forEach(p => {
        if (p.scores.length === 0) return;
        const avg = p.scores.reduce((a, b) => a + b, 0) / p.scores.length;
        const posGroups = p.position.split('/');
        posGroups.forEach(pg => {
          if (!bestByPos[pg] || avg > bestByPos[pg]) bestByPos[pg] = avg;
        });
      });

      const latestRound = valid.length > 0 ? valid[valid.length - 1] : 0;

      const stats: PlayerStat[] = Object.values(playerMap)
        .filter(p => p.scores.length > 0)
        .map(p => {
          const avg = Math.round(p.scores.reduce((a, b) => a + b, 0) / p.scores.length);
          return {
            player_id: p.player_id, player_name: p.player_name,
            team_name: p.team_name, team_id: p.team_id, position: p.position,
            avg_score: avg,
            total_score: Math.round(p.scores.reduce((a, b) => a + b, 0)),
            high_score: Math.max(...p.scores),
            low_score: Math.min(...p.scores),
            rounds_played: p.scores.length,
            latest_score: p.roundScores[latestRound] ?? null,
            roundScores: p.roundScores,
            isBestInPos: p.position.split('/').some(pg => Math.abs(avg - (bestByPos[pg] || 0)) < 1),
          };
        });

      setPlayers(stats);
    } catch (err) {
      console.error('Failed to load player data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'player_name'); }
  }, [sortKey, sortAsc]);

  const filteredPlayers = useMemo(() => {
    let result = [...players];
    if (filterTeam) result = result.filter(p => p.team_id === filterTeam);
    if (filterPos) result = result.filter(p => p.position.split('/').includes(filterPos));
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(p => p.player_name.toLowerCase().includes(lower));
    }
    result.sort((a, b) => {
      const aVal = a[sortKey]; const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string')
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return result;
  }, [players, filterTeam, filterPos, search, sortKey, sortAsc]);

  // Fixed position filter options — the 4 real AFL Fantasy positions
  const positions = ['DEF', 'MID', 'FWD', 'RUC'];

  const posBadgeColor = (pos: string) => {
    const primary = pos.split('/')[0];
    if (primary === 'DEF') return 'bg-blue-100 text-blue-700';
    if (primary === 'MID') return 'bg-green-100 text-green-700';
    if (primary === 'FWD') return 'bg-red-100 text-red-700';
    if (primary === 'RUC') return 'bg-purple-100 text-purple-700';
    return 'bg-gray-100 text-gray-600';
  };

  if (loading) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Loading player data...</p></div>;
  if (players.length === 0) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Upload round data to see player rankings.</p></div>;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search player..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-card w-56 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
        </div>

        {/* Position pills */}
        <div className="flex gap-1">
          <button onClick={() => setFilterPos(null)}
            className={cn('px-3 py-1.5 text-xs rounded-lg transition-colors',
              !filterPos ? 'bg-primary text-primary-foreground' : 'bg-card border border-border hover:bg-muted/50')}>
            ALL
          </button>
          {positions.map(pos => (
            <button key={pos} onClick={() => setFilterPos(prev => prev === pos ? null : pos)}
              className={cn('px-3 py-1.5 text-xs rounded-lg transition-colors font-medium',
                filterPos === pos ? 'bg-primary text-primary-foreground' : 'bg-card border border-border hover:bg-muted/50')}>
              {pos}
            </button>
          ))}
        </div>

        <select value={filterTeam || ''} onChange={e => setFilterTeam(e.target.value ? Number(e.target.value) : null)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/20">
          <option value="">All Teams</option>
          {TEAMS.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
        </select>

        <span className="text-xs text-muted-foreground ml-auto">{filteredPlayers.length} players</span>
      </div>

      {/* Scrollable table with pinned header */}
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div ref={tableRef} className="overflow-auto max-h-[700px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/95 backdrop-blur text-left">
                <th className="px-3 py-2.5 font-medium text-muted-foreground w-10">#</th>
                <SortTh label="Player" sortKey="player_name" current={sortKey} asc={sortAsc} onSort={handleSort} />
                <th className="px-3 py-2.5 font-medium text-muted-foreground">Team</th>
                <th className="px-3 py-2.5 font-medium text-muted-foreground text-center w-12">Pos</th>
                <SortTh label="Avg" sortKey="avg_score" current={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                <SortTh label="Total" sortKey="total_score" current={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                <SortTh label="This Wk" sortKey="latest_score" current={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                <SortTh label="High" sortKey="high_score" current={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Low</th>
                <SortTh label="GP" sortKey="rounds_played" current={sortKey} asc={sortAsc} onSort={handleSort} align="center" />
                {validRounds.map(r => (
                  <th key={r} className="px-2 py-2.5 font-medium text-muted-foreground text-center min-w-[42px]">R{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.map((player, i) => (
                <tr key={`${player.player_id}-${player.team_id}`} className={cn(i % 2 === 0 ? 'bg-card' : 'bg-muted/20', 'hover:bg-primary/5 transition-colors')}>
                  <td className="px-3 py-2 text-muted-foreground text-xs font-mono">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{player.player_name}</span>
                      {player.isBestInPos && (
                        <span className="text-[9px] bg-yellow-100 text-yellow-700 border border-yellow-300 px-1 rounded font-bold">★</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[120px]">{player.team_name}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] font-bold', posBadgeColor(player.position))}>
                      {player.position}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn('inline-block px-1.5 py-0.5 rounded text-xs font-bold', avgBadge(player.avg_score))}>
                      {player.avg_score}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{player.total_score}</td>
                  <td className={cn('px-3 py-2 text-right', scoreColor(player.latest_score))}>
                    {player.latest_score ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-green-600 font-medium">{player.high_score}</td>
                  <td className="px-3 py-2 text-right text-red-600">{player.low_score}</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">{player.rounds_played}</td>
                  {validRounds.map(r => (
                    <td key={r} className={cn('px-2 py-2 text-center text-xs', scoreColor(player.roundScores[r] ?? null))}>
                      {player.roundScores[r] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SortTh({ label, sortKey, current, asc, onSort, align = 'left' }: {
  label: string; sortKey: SortKey; current: SortKey; asc: boolean;
  onSort: (key: SortKey) => void; align?: 'left' | 'right' | 'center';
}) {
  const isActive = current === sortKey;
  return (
    <th className={cn('px-3 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap',
      align === 'right' && 'text-right', align === 'center' && 'text-center')} onClick={() => onSort(sortKey)}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {isActive && (asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </span>
    </th>
  );
}
