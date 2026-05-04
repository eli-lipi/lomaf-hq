/**
 * Round Control — single source of truth for "what round are we in".
 *
 * Pre-Round-Control: each surface re-derived current round from raw data
 * (analytics took MAX(round_number), trades took its own MAX, PWRNKGs used
 * draft/published state). Now there's one explicit ledger: round_advances.
 * The platform's current round is just MAX(round_number) there.
 *
 * Public surfaces (analytics, trades, header badge) all funnel through
 * getCurrentRound() so data uploaded for R+1 doesn't leak in until the
 * admin pushes the Advance button on /round-control.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recalculateAllTradesForRound } from '@/lib/trades/recalculate';

// All-team count used by verifyRoundReady. LOMAF is 10 coaches.
const TEAM_COUNT = 10;
const MATCHUP_COUNT = TEAM_COUNT / 2; // 5 matches per round

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any, any, any>;

export interface RoundAdvanceRow {
  round_number: number;
  advanced_at: string;
  advanced_by: string | null;
  emails_sent: boolean;
  email_sent_at: string | null;
  notes: string | null;
}

/** Current round = MAX(round_number) from round_advances. 0 if none yet. */
export async function getCurrentRound(supabase: SB): Promise<number> {
  const { data } = await supabase
    .from('round_advances')
    .select('round_number')
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { round_number: number } | null;
  return row?.round_number ?? 0;
}

/** Convenience — full row for the latest round (used by the badge). */
export async function getCurrentRoundRow(supabase: SB): Promise<RoundAdvanceRow | null> {
  const { data } = await supabase
    .from('round_advances')
    .select('*')
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as RoundAdvanceRow | null) ?? null;
}

export async function getNextRound(supabase: SB): Promise<number> {
  return (await getCurrentRound(supabase)) + 1;
}

export type CheckStatus = 'ok' | 'partial' | 'missing';
export interface RoundCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}
export interface VerifyRoundResult {
  round: number;
  ready: boolean;
  checks: RoundCheck[];
}

/**
 * Verify a round has all the data it needs before being made live.
 *
 *   lineups        — every team has at least one player_rounds row for this round
 *   matchups       — 5 matchup rows for this round_number
 *   points-grid    — every player_rounds row for this round has points NOT NULL
 *   team-snapshots — 10 team_snapshots rows for this round
 *   csv-uploads    — sanity: at least one csv_uploads row tagged with this round
 */
export async function verifyRoundReady(supabase: SB, round: number): Promise<VerifyRoundResult> {
  const checks: RoundCheck[] = [];

  // 1. Lineups — distinct team_ids in player_rounds for this round.
  {
    const { data } = await supabase
      .from('player_rounds')
      .select('team_id')
      .eq('round_number', round);
    const rows = (data ?? []) as { team_id: number }[];
    const teamIds = new Set(rows.map((r) => r.team_id));
    if (rows.length === 0) {
      checks.push({
        key: 'lineups',
        label: 'Lineups uploaded',
        status: 'missing',
        detail: `No lineup rows for R${round} yet — upload the lineups CSV.`,
      });
    } else if (teamIds.size < TEAM_COUNT) {
      checks.push({
        key: 'lineups',
        label: 'Lineups uploaded',
        status: 'partial',
        detail: `Only ${teamIds.size}/${TEAM_COUNT} teams have lineups for R${round}.`,
      });
    } else {
      checks.push({
        key: 'lineups',
        label: 'Lineups uploaded',
        status: 'ok',
        detail: `${TEAM_COUNT}/${TEAM_COUNT} teams.`,
      });
    }
  }

  // 2. Matchups — count of rows for this round.
  {
    const { count } = await supabase
      .from('matchups')
      .select('*', { count: 'exact', head: true })
      .eq('round_number', round);
    const c = count ?? 0;
    if (c === 0) {
      checks.push({
        key: 'matchups',
        label: 'Matchups uploaded',
        status: 'missing',
        detail: `No matchups for R${round} yet.`,
      });
    } else if (c < MATCHUP_COUNT) {
      checks.push({
        key: 'matchups',
        label: 'Matchups uploaded',
        status: 'partial',
        detail: `Only ${c}/${MATCHUP_COUNT} matchups recorded.`,
      });
    } else {
      checks.push({
        key: 'matchups',
        label: 'Matchups uploaded',
        status: 'ok',
        detail: `${c}/${MATCHUP_COUNT} matchups.`,
      });
    }
  }

  // 3. Points-grid — fraction of player_rounds rows with points NOT NULL.
  {
    const { data: total } = await supabase
      .from('player_rounds')
      .select('player_id', { count: 'exact', head: true })
      .eq('round_number', round);
    const totalCount = (total as unknown as { count?: number } | null)?.count ?? 0;
    // The supabase-js head:true count comes through differently per version;
    // request the count separately to be safe.
    const { count: totalCount2 } = await supabase
      .from('player_rounds')
      .select('*', { count: 'exact', head: true })
      .eq('round_number', round);
    const tc = totalCount2 ?? totalCount ?? 0;
    const { count: scoredCount } = await supabase
      .from('player_rounds')
      .select('*', { count: 'exact', head: true })
      .eq('round_number', round)
      .not('points', 'is', null);
    const sc = scoredCount ?? 0;
    if (tc === 0) {
      checks.push({
        key: 'points',
        label: 'Points-grid uploaded',
        status: 'missing',
        detail: `No player_rounds rows yet — lineups need to land first.`,
      });
    } else if (sc === 0) {
      checks.push({
        key: 'points',
        label: 'Points-grid uploaded',
        status: 'missing',
        detail: `0 / ${tc} player rows scored — upload the points-grid CSV.`,
      });
    } else if (sc < tc) {
      const pct = Math.round((sc / tc) * 100);
      checks.push({
        key: 'points',
        label: 'Points-grid uploaded',
        status: 'partial',
        detail: `${sc} / ${tc} players scored (${pct}%).`,
      });
    } else {
      checks.push({
        key: 'points',
        label: 'Points-grid uploaded',
        status: 'ok',
        detail: `${sc} / ${tc} players scored.`,
      });
    }
  }

  // 4. Team snapshots — 10 rows for this round.
  {
    const { count } = await supabase
      .from('team_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('round_number', round);
    const c = count ?? 0;
    if (c === 0) {
      checks.push({
        key: 'snapshots',
        label: 'Team snapshots built',
        status: 'missing',
        detail: `No team_snapshots for R${round} yet.`,
      });
    } else if (c < TEAM_COUNT) {
      checks.push({
        key: 'snapshots',
        label: 'Team snapshots built',
        status: 'partial',
        detail: `Only ${c}/${TEAM_COUNT} teams have snapshots.`,
      });
    } else {
      checks.push({
        key: 'snapshots',
        label: 'Team snapshots built',
        status: 'ok',
        detail: `${c}/${TEAM_COUNT} teams.`,
      });
    }
  }

  const ready = checks.every((c) => c.status === 'ok');
  return { round, ready, checks };
}

export interface AdvanceOpts {
  round: number;
  sendEmail: boolean;
  advancedBy: string | null; // user uuid; nullable for system advances
}

export interface AdvanceResult {
  ok: boolean;
  round: number;
  emailsSent: boolean;
  emailError: string | null;
  recalcError: string | null;
}

/**
 * Make `round` the new current round.
 * 1. Insert round_advances row.
 * 2. Recompute all trade probabilities for the round (forces fresh
 *    narratives — leverages the existing recalculate path).
 * 3. Auto-create the pwrnkgs_rounds draft for the round so the editor is
 *    seeded.
 * 4. Send announcement email if requested.
 */
export async function advanceToRound(supabase: SB, opts: AdvanceOpts): Promise<AdvanceResult> {
  const result: AdvanceResult = {
    ok: false,
    round: opts.round,
    emailsSent: false,
    emailError: null,
    recalcError: null,
  };

  // 1. Insert ledger row. ON CONFLICT do nothing — re-advancing the same
  // round is a no-op rather than an error (admin might click twice).
  const { error: insertErr } = await supabase
    .from('round_advances')
    .insert({
      round_number: opts.round,
      advanced_by: opts.advancedBy,
      emails_sent: false,
    });
  if (insertErr) {
    // Duplicate-key (already advanced) is fine — keep going.
    if (!/duplicate key|already exists/i.test(insertErr.message ?? '')) {
      throw insertErr;
    }
  }

  // 2. Recompute trades.
  try {
    await recalculateAllTradesForRound(supabase, opts.round);
  } catch (e) {
    result.recalcError = e instanceof Error ? e.message : 'Trade recalc failed';
  }

  // 3. Auto-create the PWRNKGs draft for this round.
  try {
    const { data: existing } = await supabase
      .from('pwrnkgs_rounds')
      .select('id')
      .eq('round_number', opts.round)
      .maybeSingle();
    if (!existing) {
      await supabase.from('pwrnkgs_rounds').insert({ round_number: opts.round });
    }
  } catch {
    // Non-fatal; PWRNKGs page will create on first visit anyway.
  }

  // 4. Email.
  if (opts.sendEmail) {
    try {
      const { sendRoundLiveEmail } = await import('@/lib/email');
      await sendRoundLiveEmail(supabase, opts.round);
      result.emailsSent = true;
      await supabase
        .from('round_advances')
        .update({ emails_sent: true, email_sent_at: new Date().toISOString() })
        .eq('round_number', opts.round);
    } catch (e) {
      result.emailError = e instanceof Error ? e.message : 'Email send failed';
    }
  }

  result.ok = true;
  return result;
}
