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

    // When target_round is set, only keep rows for the LATEST round_id in the
    // CSV (handles AFL Fantasy's off-by-one round labeling and prevents
    // ON CONFLICT duplicates from multi-round CSVs).
    let sourceData = data;
    if (explicitRound) {
      let maxParsed = 0;
      for (const row of data) {
        const r = parseRoundFromId(String(row['round_id'] || ''));
        if (r > maxParsed) maxParsed = r;
      }
      if (maxParsed > 0) {
        sourceData = data.filter(
          (row) => parseRoundFromId(String(row['round_id'] || '')) === maxParsed
        );
      }
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
