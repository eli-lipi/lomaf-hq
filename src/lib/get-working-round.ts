import { supabase } from '@/lib/supabase';
import type { PwrnkgsRound } from '@/lib/types';

/**
 * Determines the current "working round" for the This Week tabs.
 *
 * Logic:
 * 1. If there's an existing draft pwrnkgs_round → use that
 * 2. If all rounds are published → next round = latest published + 1 (auto-create draft)
 * 3. If no rounds exist at all → fall back to latest team_snapshots round
 *
 * Returns the round data, round number, and whether team_snapshots exist for it.
 */
export async function getWorkingRound(): Promise<{
  round: PwrnkgsRound | null;
  roundNumber: number | null;
  hasSnapshots: boolean;
}> {
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
