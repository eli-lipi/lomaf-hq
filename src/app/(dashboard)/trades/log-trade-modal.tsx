'use client';

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { TEAMS } from '@/lib/constants';
import { cleanPositionDisplay } from '@/lib/trades/positions';
import {
  resolvePlayerPosition,
  tierOptionsFor,
  type Tier,
} from '@/lib/trades/tiers';

interface DraftPlayer {
  player_id: number;
  player_name: string;
  pos: string | null;
  receiving_team_id: number;
  // v2 (legacy)
  expected_avg?: number | null;
  expected_games?: number | null;
  // v11 fields — set inline on the player row in the trade-logging form.
  expected_tier?: Tier | null;
  expected_games_remaining?: number | null;
  expected_games_max?: number | null;
  player_context?: string | null;
}

export interface InitialTradeData {
  tradeId: string;
  teamAId: number;
  teamBId: number;
  roundExecuted: number;
  contextNotes: string;
  players: DraftPlayer[];
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
  initial?: InitialTradeData; // if provided → edit mode
  /** Total rounds in the season — used to compute max post-trade window.
   *  Falls back to 24 if not provided. */
  seasonEndRound?: number;
}

interface PlayerOption {
  player_id: number;
  player_name: string;
  pos: string | null;
  on_roster?: boolean;
}

type Step = 'form' | 'saving';
type Timing = 'after' | 'before';

export default function LogTradeModal({ onClose, onCreated, initial }: Props) {
  const isEdit = !!initial;
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);

  const [teamAId, setTeamAId] = useState<number | null>(initial?.teamAId ?? null);
  const [teamBId, setTeamBId] = useState<number | null>(initial?.teamBId ?? null);
  // When editing, default the timing picker to "After Round N" where N = round_executed.
  const [timing, setTiming] = useState<Timing>('after');
  const [roundPicked, setRoundPicked] = useState<number>(initial?.roundExecuted ?? 1);
  const [contextNotes, setContextNotes] = useState<string>(initial?.contextNotes ?? '');
  const [players, setPlayers] = useState<DraftPlayer[]>(initial?.players ?? []);

  // round_executed = the last round where OLD rosters applied.
  // "After Round N" → trade took effect R(N+1) → round_executed = N.
  // "Before Round N" → trade took effect R(N)   → round_executed = N - 1.
  const effectiveRoundExecuted = timing === 'after' ? roundPicked : Math.max(0, roundPicked - 1);

  const handleSave = async () => {
    setError(null);
    if (!teamAId || !teamBId || teamAId === teamBId) {
      setError('Pick two different teams');
      return;
    }
    const unresolved = players.filter((p) => !p.player_id);
    if (unresolved.length > 0) {
      setError(`Resolve each player to a real roster entry (${unresolved.length} unresolved)`);
      return;
    }
    if (players.length === 0) {
      setError('Add at least one player');
      return;
    }

    setStep('saving');
    try {
      const url = isEdit ? `/api/trades/${initial!.tradeId}` : '/api/trades/create';
      const method = isEdit ? 'PATCH' : 'POST';
      const payload: Record<string, unknown> = {
        team_a_id: teamAId,
        team_b_id: teamBId,
        round_executed: effectiveRoundExecuted,
        context_notes: contextNotes || null,
        players: players.map((p) => ({
          player_id: p.player_id,
          player_name: p.player_name,
          raw_position: p.pos,
          receiving_team_id: p.receiving_team_id,
          expected_avg: p.expected_avg ?? null,
          expected_games: p.expected_games ?? null,
          // v11 fields
          expected_tier: p.expected_tier ?? null,
          expected_games_remaining: p.expected_games_remaining ?? null,
          expected_games_max: p.expected_games_max ?? null,
          player_context: p.player_context ?? null,
        })),
      };
      if (!isEdit) payload.screenshot_url = null;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setStep('form');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      {/* The trades page wrapper sets color:#fff for the dark theme, which
          cascades into this portal-rendered modal. Pin to the foreground
          token so inputs show dark text on the white panel background. */}
      <div
        className="bg-white text-foreground rounded-lg shadow-xl w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Trade' : 'Log a Trade'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded">
              {error}
            </div>
          )}

          {step === 'form' && (
            <TradeForm
              teamAId={teamAId}
              teamBId={teamBId}
              setTeamAId={setTeamAId}
              setTeamBId={setTeamBId}
              timing={timing}
              setTiming={setTiming}
              roundPicked={roundPicked}
              setRoundPicked={setRoundPicked}
              contextNotes={contextNotes}
              setContextNotes={setContextNotes}
              players={players}
              setPlayers={setPlayers}
            />
          )}

          {step === 'saving' && (
            <div className="py-10 flex flex-col items-center gap-2">
              <Loader2 className="animate-spin text-primary" size={28} />
              <p className="text-sm text-muted-foreground">Saving trade & running initial probability calc...</p>
            </div>
          )}
        </div>

        {step === 'form' && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              {isEdit ? 'Save Changes' : 'Save Trade'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Trade form
// ============================================================

interface TradeFormProps {
  teamAId: number | null;
  teamBId: number | null;
  setTeamAId: (id: number | null) => void;
  setTeamBId: (id: number | null) => void;
  timing: Timing;
  setTiming: (t: Timing) => void;
  roundPicked: number;
  setRoundPicked: (r: number) => void;
  contextNotes: string;
  setContextNotes: (s: string) => void;
  players: DraftPlayer[];
  setPlayers: (p: DraftPlayer[]) => void;
}

function TradeForm(props: TradeFormProps) {
  const {
    teamAId, teamBId, setTeamAId, setTeamBId,
    timing, setTiming, roundPicked, setRoundPicked,
    contextNotes, setContextNotes,
    players, setPlayers,
  } = props;

  const firstPostTradeRound = timing === 'after' ? roundPicked + 1 : roundPicked;
  // Round number at which OLD rosters last applied. Same logic as the
  // parent's effectiveRoundExecuted; recomputed locally so the player-
  // expectations panels can compute max-games-available reactively.
  const effectiveRoundExecuted = timing === 'after' ? roundPicked : Math.max(0, roundPicked - 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <TeamSelect label="Team A" value={teamAId} onChange={setTeamAId} excludeId={teamBId} />
        <TeamSelect label="Team B" value={teamBId} onChange={setTeamBId} excludeId={teamAId} />
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground block mb-1">
          When was the trade made?
        </label>
        <div className="flex items-center gap-2">
          <select
            value={timing}
            onChange={(e) => setTiming(e.target.value as Timing)}
            className="border border-border rounded px-3 py-2 text-sm bg-white"
          >
            <option value="after">After Round</option>
            <option value="before">Before Round</option>
          </select>
          <input
            type="number"
            min={timing === 'after' ? 0 : 1}
            value={roundPicked}
            onChange={(e) => setRoundPicked(Number(e.target.value))}
            className="w-24 border border-border rounded px-3 py-2 text-sm"
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          First round with new rosters: <span className="font-medium">R{firstPostTradeRound}</span>
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground block mb-1">
          Optional context
        </label>
        <textarea
          value={contextNotes}
          onChange={(e) => setContextNotes(e.target.value)}
          placeholder="e.g. Rozee injured, Lior buying low for finals"
          rows={2}
          className="w-full border border-border rounded px-3 py-2 text-sm resize-none"
        />
      </div>

      {/* Players */}
      {teamAId && (
        <PlayerPicker
          label={`Players going to ${TEAMS.find((t) => t.team_id === teamAId)?.team_name ?? 'Team A'}`}
          sourceTeamId={teamBId}
          receivingTeamId={teamAId}
          players={players.filter((p) => p.receiving_team_id === teamAId)}
          executedRound={effectiveRoundExecuted}
          onChange={(newList) => {
            const others = players.filter((p) => p.receiving_team_id !== teamAId);
            setPlayers([...others, ...newList]);
          }}
        />
      )}
      {teamBId && (
        <PlayerPicker
          label={`Players going to ${TEAMS.find((t) => t.team_id === teamBId)?.team_name ?? 'Team B'}`}
          sourceTeamId={teamAId}
          receivingTeamId={teamBId}
          players={players.filter((p) => p.receiving_team_id === teamBId)}
          executedRound={effectiveRoundExecuted}
          onChange={(newList) => {
            const others = players.filter((p) => p.receiving_team_id !== teamBId);
            setPlayers([...others, ...newList]);
          }}
        />
      )}

      {/* v2 — Advanced overrides per player. Optional; auto-derived when blank. */}
      {players.filter((p) => p.player_id).length > 0 && (
        <AdvancedExpectations players={players} setPlayers={setPlayers} />
      )}
    </div>
  );
}

function AdvancedExpectations({
  players,
  setPlayers,
}: {
  players: DraftPlayer[];
  setPlayers: (p: DraftPlayer[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const resolved = players.filter((p) => p.player_id);

  const updateField = (idx: number, field: 'expected_avg' | 'expected_games', value: number | null) => {
    const real = players.slice();
    // Find the matching index in `players` (which may include unresolved entries)
    let r = -1;
    let count = 0;
    for (let i = 0; i < real.length; i++) {
      if (real[i].player_id) {
        if (count === idx) { r = i; break; }
        count++;
      }
    }
    if (r >= 0) {
      real[r] = { ...real[r], [field]: value };
      setPlayers(real);
    }
  };

  return (
    <div className="border border-border rounded">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <span>Advanced — set expected average &amp; expected games per player</span>
        <span className="text-[11px] font-normal">{open ? 'Hide ▴' : 'Optional ▾'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Optional. Leave blank for auto-derived defaults (tier baseline blended
            with recent form, 4 games default). Locked once the trade is saved.
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                <th className="text-left py-1">Player</th>
                <th className="text-right py-1 px-2">Expected Avg</th>
                <th className="text-right py-1 pl-2">Expected Games (next 4)</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((p, idx) => (
                <tr key={`${p.player_id}-${idx}`} className="border-t border-border/50">
                  <td className="py-1.5 pr-2">
                    {p.player_name}
                    {cleanPositionDisplay(p.pos) && (
                      <span className="text-muted-foreground ml-1 text-[10px]">
                        ({cleanPositionDisplay(p.pos)})
                      </span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right">
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step={1}
                      placeholder="auto"
                      value={p.expected_avg ?? ''}
                      onChange={(e) =>
                        updateField(
                          idx,
                          'expected_avg',
                          e.target.value === '' ? null : Number(e.target.value)
                        )
                      }
                      className="w-20 border border-border rounded px-2 py-1 text-right tabular-nums"
                    />
                  </td>
                  <td className="py-1 pl-2 text-right">
                    <select
                      value={p.expected_games ?? ''}
                      onChange={(e) =>
                        updateField(
                          idx,
                          'expected_games',
                          e.target.value === '' ? null : Number(e.target.value)
                        )
                      }
                      className="border border-border rounded px-2 py-1 tabular-nums"
                    >
                      <option value="">auto</option>
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TeamSelect({
  label,
  value,
  onChange,
  excludeId,
}: {
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  excludeId: number | null;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground block mb-1">{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full border border-border rounded px-3 py-2 text-sm bg-white"
      >
        <option value="">— Select team —</option>
        {TEAMS.filter((t) => t.team_id !== excludeId).map((t) => (
          <option key={t.team_id} value={t.team_id}>
            {t.team_name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============================================================
// v11 — per-player expectations panel (Expected tier, Expected games,
// per-player context). Renders inline beneath each chosen player chip.
// ============================================================
const SEASON_END_ROUND = 24;

/** Best-guess byes left in the post-trade window. Without per-team bye data
 *  populated yet (team_byes table awaits manual entry), we assume 1 bye if
 *  the trade is executed before the bye block ends (R15), else 0. */
function estimatedByesInWindow(executedRound: number): number {
  return executedRound < 15 ? 1 : 0;
}

function maxGamesAvailable(executedRound: number): number {
  return Math.max(0, SEASON_END_ROUND - executedRound - estimatedByesInWindow(executedRound));
}

function PlayerExpectations({
  player,
  executedRound,
  onChange,
}: {
  player: DraftPlayer;
  executedRound: number;
  onChange: (patch: Partial<DraftPlayer>) => void;
}) {
  // Resolve the player's position via DPP fallback (FWD > DEF > RUC > MID).
  const resolved = resolvePlayerPosition(player.pos);
  const tierOpts = resolved ? tierOptionsFor(resolved) : null;
  const maxGames = maxGamesAvailable(executedRound);

  // Default expected_games_remaining to the max once we know the executed
  // round. Honours any value the user already typed.
  useEffect(() => {
    if (player.expected_games_remaining == null) {
      onChange({
        expected_games_remaining: maxGames,
        expected_games_max: maxGames,
      });
    } else if (player.expected_games_max !== maxGames) {
      onChange({ expected_games_max: maxGames });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxGames]);

  return (
    <div className="px-3 py-3 border-t border-border/60 bg-card/40">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
            Expected Average
          </label>
          {resolved && tierOpts ? (
            <>
              <select
                value={player.expected_tier ?? ''}
                onChange={(e) =>
                  onChange({ expected_tier: (e.target.value || null) as Tier | null })
                }
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-white"
              >
                <option value="">— Auto-suggest from current form —</option>
                {tierOpts.map((o) => (
                  <option key={o.tier} value={o.tier}>
                    {o.label} ({o.hint})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Position resolved as <span className="font-semibold">{resolved}</span>.
                Auto-suggested from R-to-date data unless changed.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Position unresolved — tier dropdown unavailable.
            </p>
          )}
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
            Expected Games <span className="font-normal">(out of {maxGames} remaining)</span>
          </label>
          <div className="flex items-baseline gap-2">
            <input
              type="number"
              min={0}
              max={maxGames}
              value={player.expected_games_remaining ?? maxGames}
              onChange={(e) => {
                const n = e.target.value === '' ? maxGames : Math.max(0, Math.min(maxGames, Number(e.target.value)));
                onChange({ expected_games_remaining: n });
              }}
              className="w-20 border border-border rounded px-2 py-1.5 text-sm bg-white tabular-nums"
            />
            <span className="text-sm text-muted-foreground">/ {maxGames}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            R{executedRound + 1}–R{SEASON_END_ROUND} = {SEASON_END_ROUND - executedRound} rounds, minus {estimatedByesInWindow(executedRound)} bye = <span className="font-semibold">{maxGames} max</span>.
            Drop only if you knew something at trade time (suspension, injury return).
          </p>
        </div>
      </div>
      <div className="mt-3">
        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
          Per-player context (optional)
        </label>
        <textarea
          rows={2}
          placeholder='e.g. "Injured at trade time, expected return R5" / "Selling high on hot streak"'
          value={player.player_context ?? ''}
          onChange={(e) => onChange({ player_context: e.target.value || null })}
          className="w-full border border-border rounded px-2 py-1.5 text-sm bg-white resize-none"
        />
      </div>
    </div>
  );
}

function PlayerPicker({
  label,
  sourceTeamId,
  receivingTeamId,
  players,
  executedRound,
  onChange,
}: {
  label: string;
  sourceTeamId: number | null; // players come FROM this team (sourceTeam's roster)
  receivingTeamId: number;
  players: DraftPlayer[];
  executedRound: number;
  onChange: (list: DraftPlayer[]) => void;
}) {
  const [roster, setRoster] = useState<PlayerOption[]>([]);
  const [query, setQuery] = useState('');
  const [searchAll, setSearchAll] = useState(false);
  const [allResults, setAllResults] = useState<PlayerOption[]>([]);
  const [allLoading, setAllLoading] = useState(false);

  // Track which added players were off-roster at the time they were added
  const [offRosterIds, setOffRosterIds] = useState<Set<number>>(new Set());

  // Fetch team roster (default mode)
  useEffect(() => {
    if (!sourceTeamId) {
      setRoster([]);
      return;
    }
    (async () => {
      const res = await fetch(`/api/trades/players-search?team_id=${sourceTeamId}`);
      const json = await res.json();
      setRoster(json.players ?? []);
    })();
  }, [sourceTeamId]);

  // Fetch all players when switching to league search mode, debounced by query
  useEffect(() => {
    if (!searchAll || query.length < 2) {
      setAllResults([]);
      return;
    }
    setAllLoading(true);
    const timeout = setTimeout(async () => {
      const params = new URLSearchParams({ all: 'true', q: query });
      if (sourceTeamId) params.set('team_id', String(sourceTeamId));
      const res = await fetch(`/api/trades/players-search?${params}`);
      const json = await res.json();
      setAllResults(json.players ?? []);
      setAllLoading(false);
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchAll, query, sourceTeamId]);

  const rosterFiltered = query
    ? roster.filter((r) => r.player_name.toLowerCase().includes(query.toLowerCase()))
    : roster;

  const results = searchAll ? allResults : rosterFiltered;

  const addPlayer = (opt: PlayerOption) => {
    if (players.find((p) => p.player_id === opt.player_id)) return;
    // Track off-roster status
    if (opt.on_roster === false) {
      setOffRosterIds((prev) => new Set(prev).add(opt.player_id));
    }
    onChange([
      ...players,
      { player_id: opt.player_id, player_name: opt.player_name, pos: opt.pos, receiving_team_id: receivingTeamId },
    ]);
    setQuery('');
  };

  const removePlayer = (idx: number) => {
    const removed = players[idx];
    if (removed) {
      setOffRosterIds((prev) => {
        const next = new Set(prev);
        next.delete(removed.player_id);
        return next;
      });
    }
    onChange(players.filter((_, i) => i !== idx));
  };

  const sourceTeamName = sourceTeamId
    ? TEAMS.find((t) => t.team_id === sourceTeamId)?.team_name ?? 'their team'
    : 'their team';

  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground block mb-1">{label}</label>

      <div className="space-y-3 mb-2">
        {players.map((p, idx) => {
          const isOffRoster = offRosterIds.has(p.player_id);
          return (
            <div
              key={`${p.player_id}-${idx}`}
              className={`rounded border ${
                !p.player_id
                  ? 'bg-amber-50 border-amber-200'
                  : isOffRoster
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-muted border-border'
              }`}
            >
              <div className="flex items-center justify-between px-2 py-1.5 text-sm">
                <span className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="truncate">
                    {p.player_name}
                    {cleanPositionDisplay(p.pos) && (
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({cleanPositionDisplay(p.pos)})
                      </span>
                    )}
                  </span>
                  {!p.player_id && (
                    <span className="ml-1 text-xs text-amber-700 shrink-0">⚠ needs matching</span>
                  )}
                  {isOffRoster && p.player_id > 0 && (
                    <span className="ml-1 text-[10px] text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                      Waiver / off-roster
                    </span>
                  )}
                </span>
                <button
                  onClick={() => removePlayer(idx)}
                  className="text-muted-foreground hover:text-foreground ml-2 shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
              {/* v11 — per-player expectations + context. Always visible. */}
              {p.player_id > 0 && (
                <PlayerExpectations
                  player={p}
                  executedRound={executedRound}
                  onChange={(patch) => {
                    const next = players.slice();
                    next[idx] = { ...next[idx], ...patch };
                    onChange(next);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {sourceTeamId ? (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchAll ? 'Search all league players...' : 'Search roster...'}
            className="w-full border border-border rounded px-3 py-1.5 text-sm"
          />
          {/* Toggle between roster and all-player search */}
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => {
                setSearchAll(!searchAll);
                setQuery('');
                setAllResults([]);
              }}
              className="text-[11px] text-primary hover:underline"
            >
              {searchAll
                ? `← Back to ${sourceTeamName} roster`
                : "Can\u2019t find a player? Search all league players"}
            </button>
          </div>

          {/* Results dropdown */}
          {query.length >= (searchAll ? 2 : 1) && (results.length > 0 || (searchAll && allLoading)) && (
            <div className="absolute top-[calc(100%-1.25rem)] left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-border rounded shadow-lg z-10">
              {searchAll && allLoading && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>
              )}
              {results.slice(0, 15).map((opt) => (
                <button
                  key={opt.player_id}
                  onClick={() => addPlayer(opt)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
                >
                  <span className="flex-1 truncate">
                    {opt.player_name}
                    {cleanPositionDisplay(opt.pos) && <span className="text-muted-foreground ml-1 text-xs">({cleanPositionDisplay(opt.pos)})</span>}
                  </span>
                  {searchAll && opt.on_roster === false && (
                    <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                      Not on roster
                    </span>
                  )}
                  {searchAll && opt.on_roster === true && (
                    <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                      On roster
                    </span>
                  )}
                </button>
              ))}
              {searchAll && query.length >= 2 && !allLoading && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No players found</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Pick the other team first to search their roster</p>
      )}
    </div>
  );
}
