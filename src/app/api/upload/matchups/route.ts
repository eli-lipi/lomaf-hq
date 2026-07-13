import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';
import { parseRoundFromId } from '@/lib/utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data, target_round } = body as {
      data: Record<string, unknown>[];
      target_round?: number;
    };

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    const explicitRound =
      typeof target_round === 'number' && target_round > 0 ? target_round : null;

    // When target_round is set, keep ONLY rows whose round_id parses to the
    // target round. AFL Fantasy's matchups CSV has one row per team per
    // round with correct round_id labels — we just pick out the target round.
    let sourceData = data;
    if (explicitRound) {
      const filtered = data.filter(
        (row) => parseRoundFromId(String(row['round_id'] || '')) === explicitRound
      );
      if (filtered.length > 0) sourceData = filtered;
    }

    // Parse matchups CSV rows
    const rows = sourceData.map((row: Record<string, unknown>) => {
      const roundId = String(row['round_id'] || '');
      const roundNumber = explicitRound ?? parseRoundFromId(roundId);
      const teamId = Number(row['team_id'] || 0);
      const teamName = String(row['team_name'] || '');
      const team = TEAMS.find(
        (t) => t.team_id === teamId || t.team_name.toLowerCase() === teamName.toLowerCase()
      );

      return {
        round_number: roundNumber,
        team_id: team?.team_id || teamId,
        team_name: team?.team_name || teamName,
        score_for: Number(row['score_for'] || 0),
        score_against: Number(row['score_against'] || 0),
        win: row['win'] === '1' || row['win'] === 1 || row['win'] === true || row['win'] === 'true',
        loss: row['loss'] === '1' || row['loss'] === 1 || row['loss'] === true || row['loss'] === 'true',
        tie: row['tie'] === '1' || row['tie'] === 1 || row['tie'] === true || row['tie'] === 'true',
        opp_name: String(row['opp_name'] || ''),
        opp_id: Number(row['opp_id'] || 0),
        fixture_id: Number(row['fixture_id'] || 0),
      };
    }).filter((r) => r.round_number > 0 && r.team_id > 0);

    // Upsert into matchup_rounds
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase
        .from('matchup_rounds')
        .upsert(batch, { onConflict: 'round_number,team_id' });
      if (error) throw error;
    }

    // Auto-detect score discrepancies vs lineup sums
    const rounds = [...new Set(rows.map((r) => r.round_number))];
    let newDiscrepancies = 0;

    for (const round of rounds) {
      // Get lineup sums for this round
      const { data: playerRounds } = await supabase
        .from('player_rounds')
        .select('team_id, points, is_scoring')
        .eq('round_number', round);

      if (!playerRounds) continue;

      // Compute lineup sum per team
      const lineupSums: Record<number, number> = {};
      playerRounds.forEach((pr) => {
        if (!pr.is_scoring || pr.points == null) return;
        lineupSums[pr.team_id] = (lineupSums[pr.team_id] || 0) + Number(pr.points);
      });

      // Compare with matchup scores
      const roundMatchups = rows.filter((r) => r.round_number === round);
      for (const m of roundMatchups) {
        const lineupScore = Math.round(lineupSums[m.team_id] || 0);
        const matchupScore = Math.round(m.score_for);
        const adjustment = matchupScore - lineupScore;

        if (Math.abs(adjustment) >= 1 && lineupScore > 0) {
          // Check if already exists
          const { data: existing } = await supabase
            .from('score_adjustments')
            .select('id, status')
            .eq('round_number', round)
            .eq('team_id', m.team_id)
            .single();

          // Don't overwrite confirmed entries
          if (existing?.status === 'confirmed') continue;

          await supabase
            .from('score_adjustments')
            .upsert({
              round_number: round,
              team_id: m.team_id,
              team_name: m.team_name,
              correct_score: matchupScore,
              lineup_score: lineupScore,
              adjustment,
              source: 'auto',
              status: 'unconfirmed',
            }, { onConflict: 'round_number,team_id' });
          newDiscrepancies++;
        }
      }
    }

    // Backfill blank-round ladder history from the (cumulative) matchup data.
    // The teams CSV only ever carries standings for the round it's uploaded
    // to, so any round skipped during a hiatus (e.g. the R12–R17 bye gap) has
    // no ladder. matchup_rounds holds the authoritative H2H result for every
    // round, so we reconstruct the cumulative ladder for rounds that lack a
    // real snapshot. Runs on every upload → also self-heals future gaps.
    const standingsBackfill = await backfillStandingsHistory();

    // Log upload
    await supabase.from('csv_uploads').insert({
      round_number: rounds[rounds.length - 1] || 0,
      upload_type: 'matchups',
      raw_data: data.slice(0, 20), // store sample only
    });

    // Count rounds
    const roundCounts: Record<number, number> = {};
    rows.forEach((r) => {
      roundCounts[r.round_number] = (roundCounts[r.round_number] || 0) + 1;
    });

    return NextResponse.json({
      success: true,
      count: rows.length,
      rounds: roundCounts,
      new_discrepancies: newDiscrepancies,
      standings_backfill: standingsBackfill,
    });
  } catch (err) {
    console.error('Matchups upload error:', err);
    const message = err instanceof Error ? err.message
      : typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message)
      : 'Upload failed';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

/**
 * Reconstruct the cumulative ladder (W/L/T, pts for/against, %, league rank)
 * for every round that has no authoritative standings snapshot, using the
 * cumulative matchup_rounds data as the source of truth.
 *
 * A round is "authoritative" once a teams-CSV upload has written a
 * league_rank for it — those rounds are left untouched. This fills the blank
 * rounds only (e.g. a bye-round gap), so it's safe to run on every upload and
 * is independent of the order in which the matchups/teams CSVs are uploaded.
 *
 * The upsert writes only standings columns, so line totals/ranks computed by
 * the teams-CSV upload are preserved on any row that already carries them.
 */
async function backfillStandingsHistory(): Promise<{
  filled_rounds: number[];
  skipped_rounds: number[];
}> {
  const [{ data: allMatchups }, { data: existingSnaps }] = await Promise.all([
    supabase
      .from('matchup_rounds')
      .select('round_number, team_id, score_for, score_against, win, loss, tie'),
    supabase.from('team_snapshots').select('round_number, league_rank'),
  ]);

  if (!allMatchups || allMatchups.length === 0) {
    return { filled_rounds: [], skipped_rounds: [] };
  }

  // Rounds that already carry a real ladder (league_rank set from a teams-CSV
  // upload) are authoritative and never overwritten.
  const authoritative = new Set<number>();
  for (const s of existingSnaps ?? []) {
    if (s.league_rank != null && s.league_rank > 0) authoritative.add(s.round_number);
  }

  const rounds = [...new Set(allMatchups.map((m) => m.round_number))].sort((a, b) => a - b);
  const filled: number[] = [];
  const skipped: number[] = [];
  const rowsToWrite: Record<string, unknown>[] = [];

  for (const round of rounds) {
    if (authoritative.has(round)) {
      skipped.push(round);
      continue;
    }

    const ladder = TEAMS.map((t) => {
      const upto = allMatchups.filter(
        (m) => m.team_id === t.team_id && m.round_number <= round
      );
      const wins = upto.filter((m) => m.win).length;
      const losses = upto.filter((m) => m.loss).length;
      const ties = upto.filter((m) => m.tie).length;
      const pts_for = upto.reduce((sum, m) => sum + Number(m.score_for || 0), 0);
      const pts_against = upto.reduce((sum, m) => sum + Number(m.score_against || 0), 0);
      return {
        round_number: round,
        team_id: t.team_id,
        team_name: t.team_name,
        wins,
        losses,
        ties,
        pts_for,
        pts_against,
        pct: pts_against > 0 ? (pts_for / pts_against) * 100 : 0,
        league_rank: 0,
      };
    });

    // AFL ladder order: premiership points (win = 1, tie = 0.5) then %.
    ladder.sort(
      (a, b) => b.wins + 0.5 * b.ties - (a.wins + 0.5 * a.ties) || b.pct - a.pct
    );
    ladder.forEach((row, i) => {
      row.league_rank = i + 1;
    });

    rowsToWrite.push(...ladder);
    filled.push(round);
  }

  for (let i = 0; i < rowsToWrite.length; i += 500) {
    const batch = rowsToWrite.slice(i, i + 500);
    const { error } = await supabase
      .from('team_snapshots')
      .upsert(batch, { onConflict: 'round_number,team_id' });
    if (error) throw error;
  }

  return { filled_rounds: filled, skipped_rounds: skipped };
}
