'use client';

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { TEAMS } from '@/lib/constants';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface DraftPlayer {
  player_id: number;
  player_name: string;
  pos: string | null;
  receiving_team_id: number;
}

interface PlayerOption {
  player_id: number;
  player_name: string;
  pos: string | null;
}

type Step = 'form' | 'saving';
type Timing = 'after' | 'before';

export default function LogTradeModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);

  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [timing, setTiming] = useState<Timing>('after');
  const [roundPicked, setRoundPicked] = useState<number>(1);
  const [contextNotes, setContextNotes] = useState<string>('');
  const [players, setPlayers] = useState<DraftPlayer[]>([]);

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
      const res = await fetch('/api/trades/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_a_id: teamAId,
          team_b_id: teamBId,
          round_executed: effectiveRoundExecuted,
          context_notes: contextNotes || null,
          screenshot_url: null,
          players: players.map((p) => ({
            player_id: p.player_id,
            player_name: p.player_name,
            raw_position: p.pos,
            receiving_team_id: p.receiving_team_id,
          })),
        }),
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
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Log a Trade</h2>
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
              Save Trade
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
          onChange={(newList) => {
            const others = players.filter((p) => p.receiving_team_id !== teamBId);
            setPlayers([...others, ...newList]);
          }}
        />
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

function PlayerPicker({
  label,
  sourceTeamId,
  receivingTeamId,
  players,
  onChange,
}: {
  label: string;
  sourceTeamId: number | null; // players come FROM this team (sourceTeam's roster)
  receivingTeamId: number;
  players: DraftPlayer[];
  onChange: (list: DraftPlayer[]) => void;
}) {
  const [roster, setRoster] = useState<PlayerOption[]>([]);
  const [query, setQuery] = useState('');

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

  const filtered = query
    ? roster.filter((r) => r.player_name.toLowerCase().includes(query.toLowerCase()))
    : roster;

  const addPlayer = (opt: PlayerOption) => {
    if (players.find((p) => p.player_id === opt.player_id)) return;
    onChange([
      ...players,
      { player_id: opt.player_id, player_name: opt.player_name, pos: opt.pos, receiving_team_id: receivingTeamId },
    ]);
    setQuery('');
  };

  const removePlayer = (idx: number) => {
    onChange(players.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground block mb-1">{label}</label>

      <div className="space-y-1 mb-2">
        {players.map((p, idx) => (
          <div
            key={`${p.player_id}-${idx}`}
            className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${
              p.player_id ? 'bg-muted' : 'bg-amber-50 border border-amber-200'
            }`}
          >
            <span>
              {p.player_name}
              {p.pos && <span className="text-muted-foreground ml-1 text-xs">({p.pos})</span>}
              {!p.player_id && (
                <span className="ml-2 text-xs text-amber-700">⚠ needs matching</span>
              )}
            </span>
            <button
              onClick={() => removePlayer(idx)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {sourceTeamId ? (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search roster..."
            className="w-full border border-border rounded px-3 py-1.5 text-sm"
          />
          {query && filtered.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-border rounded shadow-lg z-10">
              {filtered.slice(0, 10).map((opt) => (
                <button
                  key={opt.player_id}
                  onClick={() => addPlayer(opt)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                >
                  {opt.player_name}
                  {opt.pos && <span className="text-muted-foreground ml-1 text-xs">({opt.pos})</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Pick the other team first to search their roster</p>
      )}
    </div>
  );
}
