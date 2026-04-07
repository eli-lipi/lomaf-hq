'use client';

import { useState, useEffect, useMemo } from 'react';
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
  games_scoring: number;
}

type SortKey = 'avg_score' | 'total_score' | 'high_score' | 'rounds_played' | 'player_name';

export default function PlayersTab() {
  const [players, setPlayers] = useState<PlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('avg_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [filterTeam, setFilterTeam] = useState<number | null>(null);
  const [filterPos, setFilterPos] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const perPage = 30;

  useEffect(() => {
    loadPlayers();
  }, []);

  const loadPlayers = async () => {
    try {
      const { data: playerRounds } = await supabase
        .from('player_rounds')
        .select('player_id, player_name, team_id, team_name, pos, points, is_scoring');

      if (!playerRounds || playerRounds.length === 0) {
        setLoading(false);
        return;
      }

      // Aggregate stats per player
      const playerMap: Record<string, {
        player_id: number;
        player_name: string;
        team_name: string;
        team_id: number;
        position: string;
        scores: number[];
        scoringGames: number;
      }> = {};

      playerRounds.forEach((pr) => {
        const key = `${pr.player_id}-${pr.team_id}`;
        if (!playerMap[key]) {
          playerMap[key] = {
            player_id: pr.player_id,
            player_name: pr.player_name,
            team_name: pr.team_name,
            team_id: pr.team_id,
            position: pr.pos,
            scores: [],
            scoringGames: 0,
          };
        }
        if (pr.points != null) {
          playerMap[key].scores.push(Number(pr.points));
        }
        if (pr.is_scoring) {
          playerMap[key].scoringGames++;
        }
      });

      const stats: PlayerStat[] = Object.values(playerMap)
        .filter((p) => p.scores.length > 0)
        .map((p) => ({
          player_id: p.player_id,
          player_name: p.player_name,
          team_name: p.team_name,
          team_id: p.team_id,
          position: p.position,
          avg_score: Math.round(p.scores.reduce((a, b) => a + b, 0) / p.scores.length),
          total_score: Math.round(p.scores.reduce((a, b) => a + b, 0)),
          high_score: Math.max(...p.scores),
          low_score: Math.min(...p.scores),
          rounds_played: p.scores.length,
          games_scoring: p.scoringGames,
        }));

      setPlayers(stats);
    } catch (err) {
      console.error('Failed to load player data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'player_name');
    }
    setPage(0);
  };

  const filteredPlayers = useMemo(() => {
    let result = [...players];

    if (filterTeam) result = result.filter((p) => p.team_id === filterTeam);
    if (filterPos) result = result.filter((p) => p.position === filterPos);
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((p) => p.player_name.toLowerCase().includes(lower));
    }

    result.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    return result;
  }, [players, filterTeam, filterPos, search, sortKey, sortAsc]);

  const pagedPlayers = filteredPlayers.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(filteredPlayers.length / perPage);

  const positions = [...new Set(players.map((p) => p.position))].sort();

  if (loading) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
        <p className="text-muted-foreground">Loading player data...</p>
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
        <p className="text-muted-foreground">Upload round data to see player rankings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search player..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-card w-56 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        {/* Team filter */}
        <select
          value={filterTeam || ''}
          onChange={(e) => { setFilterTeam(e.target.value ? Number(e.target.value) : null); setPage(0); }}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All Teams</option>
          {TEAMS.map((t) => (
            <option key={t.team_id} value={t.team_id}>{t.team_name}</option>
          ))}
        </select>

        {/* Position filter */}
        <select
          value={filterPos || ''}
          onChange={(e) => { setFilterPos(e.target.value || null); setPage(0); }}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All Positions</option>
          {positions.map((pos) => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>

        <span className="text-xs text-muted-foreground ml-auto">
          {filteredPlayers.length} player{filteredPlayers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium text-muted-foreground w-10">#</th>
                <SortHeader label="Player" sortKey="player_name" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Team</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-center">Pos</th>
                <SortHeader label="Avg" sortKey="avg_score" currentKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                <SortHeader label="Total" sortKey="total_score" currentKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                <SortHeader label="High" sortKey="high_score" currentKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Low</th>
                <SortHeader label="GP" sortKey="rounds_played" currentKey={sortKey} asc={sortAsc} onSort={handleSort} align="center" />
              </tr>
            </thead>
            <tbody>
              {pagedPlayers.map((player, i) => (
                <tr
                  key={`${player.player_id}-${player.team_id}`}
                  className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}
                >
                  <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">
                    {page * perPage + i + 1}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{player.player_name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs truncate max-w-[140px]">{player.team_name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={cn(
                      'inline-block px-1.5 py-0.5 rounded text-[10px] font-bold',
                      player.position === 'DEF' ? 'bg-blue-100 text-blue-700' :
                      player.position === 'MID' ? 'bg-green-100 text-green-700' :
                      player.position === 'FWD' ? 'bg-red-100 text-red-700' :
                      player.position === 'RUC' ? 'bg-purple-100 text-purple-700' :
                      'bg-gray-100 text-gray-600'
                    )}>
                      {player.position}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold">{player.avg_score}</td>
                  <td className="px-4 py-2.5 text-right">{player.total_score}</td>
                  <td className="px-4 py-2.5 text-right text-green-600 font-medium">{player.high_score}</td>
                  <td className="px-4 py-2.5 text-right text-red-600">{player.low_score}</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground">{player.rounds_played}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-card hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-card hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  asc,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      className={cn(
        'px-4 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center'
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </span>
    </th>
  );
}
