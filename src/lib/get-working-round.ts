import { supabase } from '@/lib/supabase';
import type { PwrnkgsRound } from '@/lib/types';
import { getCurrentRound } from '@/lib/round';

/**
 * Determines the current "working round" for the This Week tabs.
 *
 * v12.2 — defers to round_advances first (the new explicit ledger). If
 * the platform has been advanced, the working round is the platform's
 * current round, with a draft pwrnkgs_round auto-created if absent.
 * Falls back to the legacy logic for empty round_advances:
 * 1. Existing draft pwrnkgs_round → use that
 * 2. All rounds published → latest published + 1 (auto-create draft)
 * 3. No rounds → latest team_snapshots round
 */
export async function getWorkingRound(): Promise<{
  round: PwrnkgsRound | null;
  roundNumber: number | null;
  hasSnapshots: boolean;
}> {
  // v12.2 — Round Control path. If the platform has an explicit current
  // round, that's what the editor works on.
  const currentRound = await getCurrentRound(supabase);
  if (currentRound > 0) {
    const { data: existing } = await supabase
      .from('pwrnkgs_rounds')
      .select('*')
      .eq('round_number', currentRound)
      .maybeSingle();

    let roundRow = existing as PwrnkgsRound | null;
    if (!roundRow) {
      const { data: created } = await supabase
        .from('pwrnkgs_rounds')
        .insert({ round_number: currentRound })
        .select()
        .single();
      roundRow = (created as PwrnkgsRound | null) ?? null;
    }

    const { count } = await supabase
      .from('team_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('round_number', currentRound);

    return {
      round: roundRow,
      roundNumber: currentRound,
      hasSnapshots: (count ?? 0) > 0,
    };
  }

  // 1. Check for an existing draft round
  const { data: draftRounds } = await supabase
    .from('pwrnkgs_rounds')
    .select('*')
    .eq('status', 'draft')
    .order('round_number', { ascending: false })
    .limit(1);

  if (draftRounds && draftRounds.length > 0) {
    const round = draftRounds[0] as PwrnkgsRound;
    const { count } = await supabase
      .from('team_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('round_number', round.round_number);

    return {
      round,
      roundNumber: round.round_number,
      hasSnapshots: (count ?? 0) > 0,
    };
  }

  // 2. No draft — get latest published round, prepare next
  const { data: published } = await supabase
    .from('pwrnkgs_rounds')
    .select('round_number')
    .eq('status', 'published')
    .order('round_number', { ascending: false })
    .limit(1);

  let nextRound: number;

  if (published && published.length > 0) {
    nextRound = published[0].round_number + 1;
  } else {
    // 3. No rounds at all — fall back to latest team_snapshots
    const { data: snapshots } = await supabase
      .from('team_snapshots')
      .select('round_number')
      .order('round_number', { ascending: false })
      .limit(1);

    if (!snapshots || snapshots.length === 0) {
      return { round: null, roundNumber: null, hasSnapshots: false };
    }
    nextRound = snapshots[0].round_number;
  }

  // Create draft for the next round
  const { data: newRound } = await supabase
    .from('pwrnkgs_rounds')
    .insert({ round_number: nextRound })
    .select()
    .single();

  // Check if snapshots exist
  const { count } = await supabase
    .from('team_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('round_number', nextRound);

  return {
    round: (newRound as PwrnkgsRound) ?? null,
    roundNumber: nextRound,
    hasSnapshots: (count ?? 0) > 0,
  };
}
