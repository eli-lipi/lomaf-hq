'use client';

import { useEffect, useMemo, useState } from 'react';
import { TEAMS } from '@/lib/constants';
import type { InjuryListPlayer, InjuryListResponse, InjuryRoundCell } from '@/app/api/afl-injuries/list/route';
import type { InjuryTrend } from '@/lib/afl-injuries';
import { cn } from '@/lib/utils';
import { TrendingDown, TrendingUp, AlertTriangle, Clock } from 'lucide-react';

type ViewMode = 'lomaf' | 'afl';

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatYmd(ymd: string | null): string {
  if (!ymd) return '—';
  const d = new Date(ymd + 'T00:00:00Z');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export default function InjuriesClient({ userTeamId }: { userTeamId: number | null }) {
  const [data, setData] = useState<InjuryListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('lomaf');
  const [onlyMyTeam, setOnlyMyTeam] = useState(false);

  useEffect(() => {
    fetch('/api/afl-injuries/list')
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? 'Sign-in required' : 'Failed to load');
        return r.json();
      })
      .then((d: InjuryListResponse) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground py-12">Loading injuries…</p>;
  if (error) return <p className="text-sm text-red-600 py-12">{error}</p>;
  if (!data) return null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-1">
        <h1 className="text-2xl font-bold">Injuries</h1>
        <p className="text-xs text-muted-foreground">
          AFL last updated {formatYmd(data.cache.afl_freshest)} · cache refreshed{' '}
          {formatRelative(data.cache.last_scraped)}
        </p>
      </div>
      <p className="text-muted-foreground text-sm mb-5">
        Official AFL.com.au injury list — annotated with LOMAF roster context and timeline trends so you can
        spot stalled prognoses (the kind that go invisible because the AFL doesn&apos;t archive prior weeks).
      </p>

      {/* View tabs */}
      <div className="flex gap-1 border-b border-border mb-4">
        <ViewTab active={view === 'lomaf'} onClick={() => setView('lomaf')}>
          By LOMAF Coach
        </ViewTab>
        <ViewTab active={view === 'afl'} onClick={() => setView('afl')}>
          By AFL Club
        </ViewTab>

        {view === 'lomaf' && userTeamId != null && (
          <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer self-center pb-2">
            <input
              type="checkbox"
              checked={onlyMyTeam}
              onChange={(e) => setOnlyMyTeam(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            Only my team
          </label>
        )}
      </div>

      {/* Top-line stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="On the list" value={String(data.cache.total)} />
        <Stat
          label="On a LOMAF roster"
          value={`${data.cache.matched_to_lomaf} / ${data.cache.total}`}
        />
        <Stat
          label="Stalled timelines"
          value={String(data.players.filter((p) => p.trend.status === 'stalled').length)}
          tone="warn"
        />
        <Stat
          label="Worsened"
          value={String(data.players.filter((p) => p.trend.status === 'worsened').length)}
          tone="bad"
        />
      </div>

      {view === 'lomaf' ? (
        <ByLomafView data={data} onlyMyTeam={onlyMyTeam} userTeamId={userTeamId} />
      ) : (
        <ByAflView data={data} />
      )}
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'bad';
}) {
  const valueColor =
    tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-red-600' : '';
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-sm">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-semibold mt-0.5 tabular-nums', valueColor)}>{value}</p>
    </div>
  );
}

function ByLomafView({
  data,
  onlyMyTeam,
  userTeamId,
}: {
  data: InjuryListResponse;
  onlyMyTeam: boolean;
  userTeamId: number | null;
}) {
  const onLomaf = data.players.filter((p) => p.lomaf_team_id != null);
  const byTeam = useMemo(() => {
    const m = new Map<number, InjuryListPlayer[]>();
    for (const p of onLomaf) {
      if (p.lomaf_team_id == null) continue;
      if (!m.has(p.lomaf_team_id)) m.set(p.lomaf_team_id, []);
      m.get(p.lomaf_team_id)!.push(p);
    }
    return m;
  }, [onLomaf]);

  const teams = TEAMS.filter((t) => byTeam.has(t.team_id))
    .filter((t) => !onlyMyTeam || t.team_id === userTeamId)
    .sort((a, b) => (byTeam.get(b.team_id)!.length - byTeam.get(a.team_id)!.length));

  if (teams.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        {onlyMyTeam ? 'No injuries on your roster — clean bill of health.' : 'No LOMAF rosters affected.'}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {teams.map((t) => {
        const players = byTeam.get(t.team_id)!;
        const stalledCount = players.filter((p) => p.trend.status === 'stalled' || p.trend.status === 'worsened').length;
        return (
          <section key={t.team_id} className="bg-card border border-border rounded-lg p-5 shadow-sm">
            <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h3 className="text-lg font-semibold">{t.team_name}</h3>
                <p className="text-xs text-muted-foreground">
                  {t.coach} · {players.length} player{players.length === 1 ? '' : 's'} listed
                  {stalledCount > 0 && (
                    <span className="text-amber-600 ml-2">
                      · {stalledCount} stalled / worsened
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {players.map((p) => (
                <PlayerRow key={`${p.player_name}-${p.club_code}`} player={p} showLomaf={false} />
              ))}
            </div>
          </section>
        );
      })}

      {/* Off-roster injuries (anyone on the AFL list not on a LOMAF roster) */}
      {!onlyMyTeam && (
        <OffRosterSection players={data.players.filter((p) => p.lomaf_team_id == null)} />
      )}
    </div>
  );
}

function OffRosterSection({ players }: { players: InjuryListPlayer[] }) {
  const [expanded, setExpanded] = useState(false);
  if (players.length === 0) return null;
  return (
    <section className="bg-card/40 border border-border rounded-lg p-5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-baseline justify-between gap-3 mb-1 text-left"
      >
        <div>
          <h3 className="text-base font-semibold text-muted-foreground">Off-roster injuries</h3>
          <p className="text-xs text-muted-foreground">
            {players.length} listed players not on any LOMAF team — useful for waiver scouting.
          </p>
        </div>
        <span className="text-xs text-primary">{expanded ? 'Hide' : 'Show'}</span>
      </button>
      {expanded && (
        <div className="space-y-2 mt-4">
          {players.map((p) => (
            <PlayerRow key={`${p.player_name}-${p.club_code}`} player={p} showLomaf />
          ))}
        </div>
      )}
    </section>
  );
}

function ByAflView({ data }: { data: InjuryListResponse }) {
  const byClub = useMemo(() => {
    const m = new Map<string, InjuryListPlayer[]>();
    for (const p of data.players) {
      if (!m.has(p.club_code)) m.set(p.club_code, []);
      m.get(p.club_code)!.push(p);
    }
    return m;
  }, [data]);
  const codes = Array.from(byClub.keys()).sort((a, b) => {
    const aName = byClub.get(a)![0].club_name;
    const bName = byClub.get(b)![0].club_name;
    return aName.localeCompare(bName);
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {codes.map((code) => {
        const players = byClub.get(code)!;
        return (
          <section key={code} className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <h3 className="text-sm font-semibold mb-3">
              {players[0].club_name} <span className="text-muted-foreground font-normal">· {players.length}</span>
            </h3>
            <div className="space-y-2">
              {players.map((p) => (
                <PlayerRow key={`${p.player_name}-${p.club_code}`} player={p} showLomaf compact />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PlayerRow({
  player,
  showLomaf,
  compact,
}: {
  player: InjuryListPlayer;
  showLomaf: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 px-3 py-3 rounded-md border border-border',
        compact ? '' : 'bg-background'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-semibold">{player.player_name}</p>
          {/* Position + AFL club, comma-separated. Position only shows
              when it's a real position (DEF/MID/FWD/RUC or DPP combo);
              BN/UTL are stripped server-side. */}
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
            {[player.lomaf_position, player.club_name].filter(Boolean).join(' · ')}
          </span>
          {showLomaf && player.lomaf_team_name && (
            <span className="text-[11px] text-primary">→ {player.lomaf_team_name}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {player.injury || 'Unspecified'}
          {player.estimated_return && (
            <>
              {' · '}
              <span className="font-medium text-foreground">{player.estimated_return}</span>
            </>
          )}
          {player.source_updated_at && (
            <span className="ml-1.5">· listed {formatYmd(player.source_updated_at)}</span>
          )}
        </p>
        {/* Trend chip — only show when there's a meaningful read */}
        {player.trend.status !== 'new' && (
          <div className="mt-2">
            <TrendChip trend={player.trend} />
          </div>
        )}
        {/* Per-round picker */}
        <div className="mt-2.5">
          <RoundPicker rounds={player.rounds} />
        </div>
      </div>
    </div>
  );
}

function TrendChip({ trend }: { trend: InjuryTrend }) {
  if (trend.status === 'stalled') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle size={11} />
        Stalled +{trend.slippageWeeks}w · {trend.weeksOnList}w on list
      </span>
    );
  }
  if (trend.status === 'accelerating') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
        <TrendingDown size={11} />
        Healing ahead of schedule
      </span>
    );
  }
  if (trend.status === 'worsened') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
        <TrendingUp size={11} />
        Worsened
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
      <Clock size={11} />
      On track · {trend.weeksOnList}w on list
    </span>
  );
}

/**
 * Round-by-round picker. One tile per LOMAF round, R1..R24.
 *
 * Tile rendering rules:
 *   played (points > 0)        → green
 *   played round, no points    → red (DNP, regardless of listing)
 *   future round, predicted out → white striped with red
 *   future round, expected back → white
 *
 * The tile text shows the AFL-listed ETA when the snapshot for that
 * round had one (e.g. R8 · "2-3w"). Otherwise just the round number.
 */
function RoundPicker({ rounds }: { rounds: InjuryRoundCell[] }) {
  if (rounds.length === 0) return null;

  const stripedStyle = {
    backgroundImage:
      'repeating-linear-gradient(45deg, transparent 0, transparent 3.5px, rgba(220,38,38,0.45) 3.5px, rgba(220,38,38,0.45) 6px)',
    backgroundColor: '#ffffff',
  } as const;

  return (
    <div className="flex flex-wrap gap-1">
      {rounds.map((c) => {
        const isPlayedRound = c.points != null;
        const played = c.points != null && c.points > 0;
        const dnp = c.points === 0;
        const isFuture = !isPlayedRound;

        let cls = '';
        let style: React.CSSProperties | undefined;
        if (played) {
          cls = 'bg-green-100 text-green-800 border-green-200';
        } else if (dnp) {
          cls = 'bg-red-100 text-red-800 border-red-300';
        } else if (isFuture && c.predicted_injured) {
          cls = 'text-red-700 border-red-200';
          style = stripedStyle;
        } else {
          // future, expected back
          cls = 'bg-white text-muted-foreground border-border';
        }

        const title = `R${c.round}${
          c.points != null ? ` · ${c.points} pts` : c.predicted_injured ? ' · predicted out' : ' · not played yet'
        }${c.eta ? ` · listed ${c.eta}` : ''}${c.injury ? ` · ${c.injury}` : ''}`;

        return (
          <span
            key={c.round}
            title={title}
            style={style}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] tabular-nums border whitespace-nowrap',
              cls
            )}
          >
            <span className="font-semibold">R{c.round}</span>
            {c.eta && <span className="font-normal opacity-90">· {c.eta}</span>}
          </span>
        );
      })}
    </div>
  );
}
