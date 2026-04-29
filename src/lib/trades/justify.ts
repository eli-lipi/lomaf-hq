/**
 * v12 — Trade Justification orchestration.
 *
 * Locked at trade-execution time. Reads ladder + line ranks at trade time,
 * each player's expected average, position, pre-trade form, and the admin
 * context note, then asks Claude to write a tight headline + bullet
 * justification of WHY the trade makes sense for each side.
 *
 * The result is persisted on `trades.ai_justification` (text) — a column
 * added by migration-trades-v12.sql. If the column is missing on a given
 * deploy, callers must handle the resilient-write fallback (strip + retry).
 */

import { generateTradeJustification } from './ai-assessment';
import { fetchSnapshot, snapshotToLines } from './recalculate';
import { cleanPositionDisplay } from './positions';
import type { SupabaseClient } from '@supabase/supabase-js';

interface PlayerForJustification {
  player_id: number;
  player_name: string;
  raw_position: string | null;
  position: string | null; // normalised
  draft_position?: string | null; // v12 — locked league identity
  receiving_team_id: number;
  receiving_team_name: string;
  expected_avg: number | null | undefined;
  expected_tier?: string | null;
  pre_trade_avg?: number | null;
  player_context?: string | null;
}

export interface BuildJustificationInputs {
  teamAId: number;
  teamAName: string;
  teamBId: number;
  teamBName: string;
  roundExecuted: number;
  contextNotes: string | null;
  players: PlayerForJustification[];
}

/** Format a "wins-losses" record from a team_snapshots row. */
function recordFromSnapshot(snap: { wins?: number | null; losses?: number | null; ties?: number | null } | null): string {
  if (!snap) return '?-?';
  const w = snap.wins ?? 0;
  const l = snap.losses ?? 0;
  const t = snap.ties ?? 0;
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

/**
 * Build inputs from trade rows + DB lookups, call the AI, return the
 * justification string ('headline\n- bullet\n- bullet'). Returns '' on
 * AI / network failure so the caller can persist a null without breaking
 * the create flow.
 */
export async function buildAndGenerateJustification(
  supabase: SupabaseClient,
  inputs: BuildJustificationInputs
): Promise<string> {
  // Snapshots at the round BEFORE the trade — the state the trade was
  // made in.
  const [snapA, snapB] = await Promise.all([
    fetchSnapshot(supabase, inputs.teamAId, inputs.roundExecuted - 1),
    fetchSnapshot(supabase, inputs.teamBId, inputs.roundExecuted - 1),
  ]);

  const playersByTeam = new Map<number, PlayerForJustification[]>();
  for (const p of inputs.players) {
    if (!playersByTeam.has(p.receiving_team_id)) playersByTeam.set(p.receiving_team_id, []);
    playersByTeam.get(p.receiving_team_id)!.push(p);
  }

  const formatPlayer = (p: PlayerForJustification) => {
    const livePos = cleanPositionDisplay(p.raw_position) ?? p.position ?? '?';
    const draftPos = p.draft_position;
    // v12 — surface drafted-as identity when it differs from current pos
    // (e.g. drafted MID but slotted FWD). Tells the AI to factor in
    // position-pivot value, scarcity, the role this player owns.
    const posStr = draftPos && draftPos !== livePos
      ? `${livePos}, drafted ${draftPos}`
      : livePos;
    const expected = p.expected_avg != null ? `${Math.round(p.expected_avg)} avg` : '?';
    const tier = p.expected_tier ? ` (${p.expected_tier})` : '';
    const pre = p.pre_trade_avg != null ? Math.round(p.pre_trade_avg).toString() : '?';
    const note = p.player_context ? `\n      trader's note: "${p.player_context}"` : '';
    return `  - ${p.player_name} (${posStr}) → ${p.receiving_team_name}: bet ${expected}${tier}, pre-trade season avg ${pre}${note}`;
  };

  const playerBreakdown = inputs.players.map(formatPlayer).join('\n');

  return generateTradeJustification(
    {
      teamA: {
        name: inputs.teamAName,
        ladder: snapA?.league_rank ?? null,
        record: recordFromSnapshot(snapA),
        preTradeLines: snapshotToLines(snapA),
      },
      teamB: {
        name: inputs.teamBName,
        ladder: snapB?.league_rank ?? null,
        record: recordFromSnapshot(snapB),
        preTradeLines: snapshotToLines(snapB),
      },
      playerBreakdown,
      roundExecuted: inputs.roundExecuted,
      contextNotes: inputs.contextNotes,
    },
    supabase
  );
}
