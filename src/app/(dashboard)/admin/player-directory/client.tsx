'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowUp, ArrowDown, ArrowUpDown, Database } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  classifyPosition,
  normalizePosition,
  POSITION_COLOR,
  POSITION_LABEL,
  POSITION_HIERARCHY,
  type Position,
} from '@/lib/positions';

// ─── Types ──────────────────────────────────────────────────────────────────
interface PlayerRow {
  player_id: number | null;
  player_name: string;
  afl_club: string | null;
  position: string | null;
  owner_team_name: string | null;
  age: number | null;
  career_games: number | null;
  seasons: number | null;
  adp: number | null;
  owned_pct: number | null;
  proj_avg: number | null;
  avg_pts: number | null;
  total_pts: number | null;
  last5_avg: number | null;
  last3_avg: number | null;
  last1: number | null;
  games_played: number | null;
  tog_pct: number | null;
  goals: number | null;
  behinds: number | null;
  uploaded_at: string | null;
}

type SortKey =
  | 'player_name'
  | 'afl_club'
  | 'position'
  | 'hierarchy'
  | 'owner_team_name'
  | 'age'
  | 'adp'
  | 'owned_pct'
  | 'proj_avg'
  | 'avg_pts'
  | 'last5_avg'
  | 'last3_avg'
  | 'last1'
  | 'games_played'
  | 'tog_pct';

type SortDir = 'asc' | 'desc';

// ─── Page ───────────────────────────────────────────────────────────────────
export default function PlayerDirectoryClient() {
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUploaded, setLastUploaded] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filterClub, setFilterClub] = useState<string>('');
  const [filterHierarchy, setFilterHierarchy] = useState<Position | ''>('');
  const [filterOwner, setFilterOwner] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('avg_pts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      // Paginated — players table grows to ~600 rows but Supabase
      // still caps each REST request at 1000.
      const out: PlayerRow[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('players')
          .select(
            'player_id, player_name, afl_club, position, owner_team_name, age, career_games, seasons, adp, owned_pct, proj_avg, avg_pts, total_pts, last5_avg, last3_avg, last1, games_played, tog_pct, goals, behinds, uploaded_at'
          )
          .range(offset, offset + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        out.push(...(data as PlayerRow[]));
        if (data.length < 1000) break;
        offset += 1000;
      }
      setRows(out);
      // Latest upload timestamp — shown in the header banner so the
      // commissioner can confirm at a glance whether the directory is
      // fresh for the current round.
      if (out.length > 0) {
        const latest = out
          .map((r) => r.uploaded_at)
          .filter((s): s is string => !!s)
          .sort()
          .at(-1);
        setLastUploaded(latest ?? null);
      }
    } catch (err) {
      console.error('Player directory load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Derived sets for filter dropdowns ────────────────────────────
  const aflClubs = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.afl_club) s.add(r.afl_club);
    return Array.from(s).sort();
  }, [rows]);

  const owners = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.owner_team_name) s.add(r.owner_team_name);
    return Array.from(s).sort();
  }, [rows]);

  // ─── Filtered + sorted view ───────────────────────────────────────
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (needle && !r.player_name.toLowerCase().includes(needle)) return false;
      if (filterClub && r.afl_club !== filterClub) return false;
      if (filterHierarchy && classifyPosition(r.position) !== filterHierarchy) return false;
      if (filterOwner) {
        if (filterOwner === '__none__') {
          if (r.owner_team_name) return false;
        } else if (r.owner_team_name !== filterOwner) {
          return false;
        }
      }
      return true;
    });

    const direction = sortDir === 'asc' ? 1 : -1;
    const numCmp = (a: number | null, b: number | null) => {
      const an = a ?? -Infinity;
      const bn = b ?? -Infinity;
      return an < bn ? -1 : an > bn ? 1 : 0;
    };
    const strCmp = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '');

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'player_name':
          cmp = strCmp(a.player_name, b.player_name);
          break;
        case 'afl_club':
          cmp = strCmp(a.afl_club, b.afl_club);
          break;
        case 'position':
          cmp = strCmp(normalizePosition(a.position), normalizePosition(b.position));
          break;
        case 'hierarchy':
          cmp = strCmp(classifyPosition(a.position), classifyPosition(b.position));
          break;
        case 'owner_team_name':
          cmp = strCmp(a.owner_team_name, b.owner_team_name);
          break;
        case 'age':
          cmp = numCmp(a.age, b.age);
          break;
        case 'adp':
          cmp = numCmp(a.adp, b.adp);
          break;
        case 'owned_pct':
          cmp = numCmp(a.owned_pct, b.owned_pct);
          break;
        case 'proj_avg':
          cmp = numCmp(a.proj_avg, b.proj_avg);
          break;
        case 'avg_pts':
          cmp = numCmp(a.avg_pts, b.avg_pts);
          break;
        case 'last5_avg':
          cmp = numCmp(a.last5_avg, b.last5_avg);
          break;
        case 'last3_avg':
          cmp = numCmp(a.last3_avg, b.last3_avg);
          break;
        case 'last1':
          cmp = numCmp(a.last1, b.last1);
          break;
        case 'games_played':
          cmp = numCmp(a.games_played, b.games_played);
          break;
        case 'tog_pct':
          cmp = numCmp(a.tog_pct, b.tog_pct);
          break;
      }
      if (cmp !== 0) return cmp * direction;
      return strCmp(a.player_name, b.player_name);
    });
  }, [rows, search, filterClub, filterHierarchy, filterOwner, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Default numeric columns to desc (highest first) and text columns to asc.
      const textCols: SortKey[] = ['player_name', 'afl_club', 'position', 'hierarchy', 'owner_team_name'];
      setSortDir(textCols.includes(key) ? 'asc' : 'desc');
    }
  };

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
          <Database size={22} />
          Player Directory
        </h1>
        <p className="text-sm text-muted-foreground">
          Canonical source of truth for every player in LOMAF — sourced from the weekly Players CSV
          upload. Every feature on the platform reads from this table for positions, averages, and
          ownership.
        </p>
      </div>

      {/* Status banner */}
      <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <Stat label="Players in directory" value={String(rows.length)} />
          <Stat
            label="Visible after filters"
            value={String(visible.length)}
            tone={visible.length === rows.length ? undefined : 'accent'}
          />
          <Stat label="AFL clubs" value={String(aflClubs.length)} />
          <Stat
            label="Owned by LOMAF coach"
            value={`${rows.filter((r) => r.owner_team_name).length}`}
          />
        </div>
        {lastUploaded && (
          <span className="text-[11px] text-muted-foreground">
            Last upload: {new Date(lastUploaded).toLocaleString()}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player name…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <FilterSelect
          label="AFL Club"
          value={filterClub}
          onChange={setFilterClub}
          options={[
            { value: '', label: 'All clubs' },
            ...aflClubs.map((c) => ({ value: c, label: c })),
          ]}
        />
        <FilterSelect
          label="Hierarchy"
          value={filterHierarchy}
          onChange={(v) => setFilterHierarchy(v as Position | '')}
          options={[
            { value: '', label: 'All positions' },
            ...POSITION_HIERARCHY.map((p) => ({ value: p, label: POSITION_LABEL[p] })),
          ]}
        />
        <FilterSelect
          label="Owner"
          value={filterOwner}
          onChange={setFilterOwner}
          options={[
            { value: '', label: 'All players' },
            { value: '__none__', label: 'Available (no owner)' },
            ...owners.map((o) => ({ value: o, label: o })),
          ]}
        />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-x-auto">
        {loading ? (
          <div className="py-16 text-center text-muted-foreground">Loading directory…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            No players uploaded yet — head to /upload to add the Players CSV.
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <Th label="Name" k="player_name" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                <Th label="Club" k="afl_club" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                <Th label="Position" k="position" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                <Th label="Hierarchy" k="hierarchy" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                <Th label="Owner" k="owner_team_name" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                <Th label="Age" k="age" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <Th label="ADP" k="adp" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <Th label="Own %" k="owned_pct" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <Th label="Proj" k="proj_avg" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <Th label="Avg" k="avg_pts" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <Th label="L5" k="last5_avg" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <Th label="L3" k="last3_avg" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <Th label="L1" k="last1" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <Th label="Games" k="games_played" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <Th label="TOG%" k="tog_pct" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const h = classifyPosition(r.position);
                const normPos = normalizePosition(r.position) ?? '—';
                return (
                  <tr
                    key={`${r.player_id ?? r.player_name}-${i}`}
                    className="border-b border-border/40 last:border-b-0 hover:bg-muted/20"
                  >
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{r.player_name}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs uppercase">
                      {r.afl_club ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">{normPos}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
                        style={{ background: POSITION_COLOR[h] }}
                      >
                        {h}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.owner_team_name ? (
                        <span className="text-foreground">{r.owner_team_name}</span>
                      ) : (
                        <span className="italic text-muted-foreground/70">Available</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-xs">{r.age ?? '—'}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-xs">
                      {fmt1(r.adp)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-xs">
                      {fmt1(r.owned_pct)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-xs">
                      {fmt1(r.proj_avg)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums font-semibold">
                      {fmt1(r.avg_pts)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-xs">
                      {fmt1(r.last5_avg)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-xs">
                      {fmt1(r.last3_avg)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-xs">
                      {fmt1(r.last1)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-xs">
                      {r.games_played ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-xs">
                      {fmt1(r.tog_pct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function fmt1(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n).toFixed(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'accent';
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('text-base font-bold tabular-nums', tone === 'accent' && 'text-primary')}>
        {value}
      </p>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm bg-background border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Th({
  label,
  k,
  sortKey,
  dir,
  onClick,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align: 'left' | 'center';
}) {
  const isActive = sortKey === k;
  return (
    <th
      className={cn(
        'px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap select-none',
        align === 'center' ? 'text-center' : 'text-left'
      )}
    >
      <button
        onClick={() => onClick(k)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground transition-colors',
          isActive && 'text-foreground'
        )}
      >
        <span>{label}</span>
        {isActive ? (
          dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
        ) : (
          <ArrowUpDown size={10} className="opacity-40" />
        )}
      </button>
    </th>
  );
}
